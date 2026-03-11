"""
rag_summarize.py  —  AlphaSense RAG-powered Financial PDF Summarizer
Pipeline: extract → chunk → embed (SentenceTransformers) → FAISS index
         → section-specific retrieval → structured summary PDF (reportlab)
"""

import sys
import re
import numpy as np
import pdfplumber
import faiss
from sentence_transformers import SentenceTransformer
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, HRFlowable, KeepTogether
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib import colors

# ── Constants ────────────────────────────────────────────────────────────────
CHUNK_SIZE    = 800
CHUNK_OVERLAP = 120
TOP_K         = 10   # fetch more chunks so financial sections have more to pick from
MODEL_NAME    = "all-MiniLM-L6-v2"

# Financial section queries & settings
SECTIONS = [
    {
        "title": "1. Executive Summary",
        "query": "company overview business description operations products services revenue",
        "bullets": 5,
        "requires_numbers": False,
    },
    {
        "title": "2. Financial Highlights",
        "query": "total revenue net income earnings per share EPS diluted billion million grew increased decreased",
        "bullets": 6,
        "requires_numbers": True,   # every bullet MUST contain a number
    },
    {
        "title": "3. Revenue & Profit Overview",
        "query": "revenue profit loss gross margin operating income EBITDA net margin percentage growth year over year",
        "bullets": 6,
        "requires_numbers": True,
    },
    {
        "title": "4. Key Risks & Challenges",
        "query": "risk factor challenge uncertainty debt interest expense credit loss regulatory compliance litigation",
        "bullets": 5,
        "requires_numbers": False,
    },
    {
        "title": "5. Strategic Initiatives",
        "query": "strategy acquisition investment partnership expansion product innovation capital expenditure",
        "bullets": 5,
        "requires_numbers": False,
    },
    {
        "title": "6. Future Outlook",
        "query": "guidance outlook forecast projected expected target next year growth plan dividend share repurchase",
        "bullets": 5,
        "requires_numbers": False,
    },
]


# ── 1. PDF Text Extraction ────────────────────────────────────────────────────

def extract_text(pdf_path: str) -> str:
    """
    Extract text from PDF using pdfplumber with word-level spacing.
    Tables are extracted separately to get structured content without garbling.
    """
    all_text_parts = []

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:

            # --- Get table bounding boxes so we can exclude them from body text ---
            tables = page.find_tables()
            table_bboxes = [tbl.bbox for tbl in tables]

            # --- Extract body text (words) outside table regions ---
            words = page.extract_words(
                x_tolerance=4,
                y_tolerance=4,
                keep_blank_chars=False,
                use_text_flow=True,
            )

            body_words = []
            for w in words:
                cx = (w["x0"] + w["x1"]) / 2
                cy = (w["top"] + w["bottom"]) / 2
                in_table = any(
                    bx0 <= cx <= bx1 and by0 <= cy <= by1
                    for bx0, by0, bx1, by1 in table_bboxes
                )
                if not in_table:
                    body_words.append(w["text"])

            if body_words:
                all_text_parts.append(" ".join(body_words))

            # --- Extract tables as structured rows ---
            for tbl in tables:
                try:
                    rows = tbl.extract()
                    if not rows:
                        continue
                    for row in rows:
                        cells = [str(c).strip() for c in row if c and str(c).strip()]
                        if not cells:
                            continue
                        formatted = format_table_row(cells)
                        if formatted:
                            all_text_parts.append(formatted)
                except Exception:
                    pass

    return "\n".join(all_text_parts)


def format_table_row(cells: list) -> str:
    """
    Convert a list of table cells into a readable financial sentence.
    e.g. ['Revenue', '$60.6', '$58.5']  →  'Revenue: $60.6 | $58.5'
         ['Net Income', '3,134', '2,765'] → 'Net Income: 3,134 | 2,765'
    Skips rows that are all headers with no numbers.
    """
    if not cells:
        return ""
    # Must contain at least one numeric-looking cell (besides label) to be useful
    numeric_cells = [c for c in cells[1:] if re.search(r'\d', c)]
    if not numeric_cells:
        return ""   # pure header row — skip
    label = cells[0].strip().rstrip(':')
    values = "  |  ".join(c.strip() for c in cells[1:] if c.strip())
    return f"{label}: {values}"


def fix_spacing(text: str) -> str:
    """
    Insert spaces into concatenated CamelCase / ALLCAPS runs that pdfplumber
    sometimes produces from certain PDF encodings.
    e.g. "CardMemberReceivables" -> "Card Member Receivables"
    """
    # Insert space before a capital letter that follows a lowercase letter
    text = re.sub(r'([a-z])([A-Z])', r'\1 \2', text)
    # Insert space before digits following letters and vice versa
    text = re.sub(r'([a-zA-Z])(\d)', r'\1 \2', text)
    text = re.sub(r'(\d)([a-zA-Z])', r'\1 \2', text)
    return text


def clean_text(text: str) -> str:
    """Remove noise: non-ASCII, excessive whitespace, repeated dashes."""
    text = re.sub(r'[^\x20-\x7E\n]', ' ', text)
    text = fix_spacing(text)
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r'-{3,}', '', text)
    text = re.sub(r'\.{3,}', '...', text)
    return text.strip()


# ── 2. Garbled text detection ─────────────────────────────────────────────────

def _max_word_len(sentence: str) -> int:
    words = sentence.split()
    return max((len(w) for w in words), default=0)

def _long_word_ratio(sentence: str, threshold: int = 20) -> float:
    words = sentence.split()
    if not words:
        return 0.0
    long = sum(1 for w in words if len(w) > threshold)
    return long / len(words)

def is_garbled(sentence: str) -> bool:
    """
    Return True if the sentence looks like garbage, table column data, or
    raw number sequences that should not appear as a bullet.
    """
    if _max_word_len(sentence) > 35:
        return True
    if _long_word_ratio(sentence, threshold=20) > 0.25:
        return True
    alpha = sum(1 for c in sentence if c.isalpha())
    if len(sentence) > 0 and alpha / len(sentence) < 0.38:
        return True
    # Reject if it contains 3+ consecutive standalone dollar values (table column dump)
    if len(re.findall(r'\$\s*[\d,\.]+', sentence)) >= 3:
        return True
    # Reject if it contains year columns like '2024 2023 2022' (table header dump)
    if re.search(r'\b(20\d{2})\s+(20\d{2})\s+(20\d{2})\b', sentence):
        return True
    return False


# Reference/noise patterns to strip from sentences before outputting as bullets
_STRIP_REFS = [
    # Table headers / scope markers
    re.compile(r'\(?in millions(?:,\s*except[^)]*)?\)?', re.I),
    re.compile(r'\(?millions of dollars\)?', re.I),
    re.compile(r'\(?millions\)?(?=\s)', re.I),
    re.compile(r'Year Ended December 3[01],?\s*', re.I),
    re.compile(r'Three [Mm]onths [Ee]nded [A-Za-z]+ 3[01],?\s*', re.I),
    re.compile(r'Nine [Mm]onths [Ee]nded [A-Za-z]+ 3[01],?\s*', re.I),
    re.compile(r'December 31,?\s*', re.I),
    re.compile(r'March 31,?\s*', re.I),
    # Footnote markers like (a), (b), (1), etc.
    re.compile(r'\([a-z\d]{1,2}\)'),
    # Pipe separators left from table formatting
    re.compile(r'\|'),
]

# Sentences that are clearly table intros or index lines — reject entirely
_REJECT_PATTERNS = [
    re.compile(r'following table', re.I),
    re.compile(r'as follows:', re.I),
    re.compile(r'see note \d', re.I),
    re.compile(r'^table \d', re.I),
    re.compile(r'refer to note', re.I),
    re.compile(r'\(dollars in', re.I),
]


def clean_sentence(sent: str) -> str:
    """
    Strip table references, footnote markers, and other noise from a sentence.
    Also ensure the sentence ends at a natural boundary (not mid-word).
    Returns empty string if the sentence should be rejected entirely.
    """
    # Reject table-intro sentences
    for pat in _REJECT_PATTERNS:
        if pat.search(sent):
            return ""

    # Strip known noise patterns
    for pat in _STRIP_REFS:
        sent = pat.sub('', sent)

    # Collapse multiple spaces left by stripping
    sent = re.sub(r'[ \t]+', ' ', sent).strip()
    sent = re.sub(r'\s*,\s*,', ',', sent)  # fix double commas
    sent = re.sub(r'^[,;:\-\s]+', '', sent)  # strip leading punctuation

    # If sentence ends mid-word (truncated), try to close at last period/comma
    if sent.endswith('...') or (len(sent) > 80 and not sent[-1] in '.!?:'):
        # Walk back to the last sentence-ending punctuation
        last_end = max(sent.rfind('.'), sent.rfind('!'), sent.rfind('?'))
        if last_end > len(sent) * 0.5:  # only truncate if we keep >50% of content
            sent = sent[:last_end + 1]

    # Final cleanup: strip trailing noise
    sent = sent.strip(' ,;:|\t')
    sent = re.sub(r'\s+', ' ', sent)

    # Too short after cleaning = reject
    if len(sent) < 40:
        return ""

    return sent


# ── 3. Chunking ───────────────────────────────────────────────────────────────

def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP):
    """Split text into overlapping word-based chunks."""
    words = text.split()
    chunks = []
    start = 0
    while start < len(words):
        end = min(start + chunk_size, len(words))
        chunk = " ".join(words[start:end])
        if len(chunk.strip()) > 80:   # skip tiny trailing chunks
            chunks.append(chunk)
        if end == len(words):
            break
        start += chunk_size - overlap
    return chunks


# ── 4. Embedding & FAISS Index ────────────────────────────────────────────────

def build_index(chunks: list, model: SentenceTransformer):
    """Embed all chunks and build a FAISS flat L2 index."""
    embeddings = model.encode(chunks, show_progress_bar=False, batch_size=32)
    embeddings = np.array(embeddings, dtype="float32")
    faiss.normalize_L2(embeddings)                        # cosine similarity via inner-product
    dim = embeddings.shape[1]
    index = faiss.IndexFlatIP(dim)                        # inner product = cosine after normalisation
    index.add(embeddings)
    return index


# ── 5. Retrieval ──────────────────────────────────────────────────────────────

def retrieve(query: str, index, chunks: list, model: SentenceTransformer, top_k: int = TOP_K):
    """Retrieve top-K most relevant chunks for a query."""
    q_emb = model.encode([query], show_progress_bar=False)
    q_emb = np.array(q_emb, dtype="float32")
    faiss.normalize_L2(q_emb)
    _, indices = index.search(q_emb, min(top_k, len(chunks)))
    return [chunks[i] for i in indices[0] if i >= 0]


# ── Financial figure detection helpers ───────────────────────────────────────

# Patterns that indicate real financial data (not theory)
_FIN_STRONG = re.compile(
    r'\$\s*[\d,\.]+\s*(billion|million|trillion|B|M|bn|mn)?'
    r'|[\d,\.]+\s*(billion|million|trillion)'
    r'|[\d,]+\s*%'
    r'|\bEPS\b|\bEBITDA\b|\bROE\b|\bROA\b',
    re.I
)
_FIN_WEAK = re.compile(r'\b\d[\d,\.]*\b')   # any number at all


def score_sentence(sent: str, word_freq: dict) -> float:
    """
    Score a sentence for financial relevance:
    - TF keyword richness (base)
    - 5x multiplier for explicit dollar/percent/billion/million values
    - 2x multiplier for any number
    - penalty for very short or vague sentences
    """
    words = re.findall(r'\b[a-zA-Z]{3,}\b', sent.lower())
    base = sum(word_freq.get(w, 0) for w in words if w not in _STOPWORDS)
    if _FIN_STRONG.search(sent):
        return base * 5.0
    if _FIN_WEAK.search(sent):
        return base * 2.0
    return base


def has_numbers(sent: str) -> bool:
    """Return True if sentence contains at least one numeric value."""
    return bool(_FIN_WEAK.search(sent))


# ── 6. Bullet extraction ──────────────────────────────────────────────────────

_STOPWORDS = set("""a an the and or but in on at to for of with is are was were
    be been being have has had do does did will would could should may might
    that this these those it its by from as up out if into through during
    before after above below between each other than then there when where
    which who whom how all both just because so also can his her their our
    your my we they he she i you""".split())


def extract_bullets(
    retrieved_chunks: list,
    n_bullets: int,
    used_globally: list,
    requires_numbers: bool = False,
) -> list:
    """
    From retrieved chunks → sentences → filter garbled → score (financial-aware)
    → deduplicate globally → return top-N bullets.
    If requires_numbers=True, only sentences with numeric values are accepted.
    """
    from collections import Counter

    all_text = " ".join(retrieved_chunks)
    raw_sents = re.split(r'(?<=[.!?])\s+(?=[A-Z])', all_text)

    # Also split on newlines followed by meaningful content
    sents = []
    for s in raw_sents:
        sub = [p.strip() for p in s.split('\n') if len(p.strip()) > 50]
        sents.extend(sub if sub else ([s.strip()] if len(s.strip()) > 50 else []))

    # Filter: garbled, too short, and optionally requires a number
    clean_sents_raw = [
        s for s in sents
        if not is_garbled(s) and len(s) > 55
    ]

    # Apply sentence cleaner (strip references, fix truncation)
    cleaned_pairs = []
    for s in clean_sents_raw:
        cs = clean_sentence(s)
        if cs:
            cleaned_pairs.append((cs, s))  # (cleaned, original)

    # Apply numbers filter on cleaned version
    if requires_numbers:
        cleaned_pairs = [(cs, orig) for cs, orig in cleaned_pairs if has_numbers(cs)]

    # Fallback: if requires_numbers produced nothing, relax that constraint
    if not cleaned_pairs:
        cleaned_pairs = [(clean_sentence(s), s) for s in clean_sents_raw if clean_sentence(s)]

    if not cleaned_pairs:
        return ["No relevant information could be retrieved for this section."]

    # TF scoring (financial relevance boost for numbers)
    word_freq = Counter()
    for cs, _ in cleaned_pairs:
        for w in re.findall(r'\b[a-zA-Z]{3,}\b', cs.lower()):
            if w not in _STOPWORDS:
                word_freq[w] += 1

    scored = []
    for cs, _ in cleaned_pairs:
        sc = score_sentence(cs, word_freq)
        scored.append((sc, cs))

    scored.sort(key=lambda x: -x[0])

    # Deduplicate: skip if too similar to anything seen in THIS section
    # OR any PREVIOUS section (used_globally) — threshold 0.45 (tighter)
    seen_local, result = [], []
    for _, sent in scored:
        all_seen = used_globally + seen_local
        if any(_jaccard(sent, s) > 0.45 for s in all_seen):
            continue  # already used somewhere — skip
        seen_local.append(sent)
        bullet = sent if len(sent) <= 240 else sent[:237] + "..."
        result.append(bullet)
        if len(result) == n_bullets:
            break

    # Register winners into the global cross-section pool
    used_globally.extend(seen_local)

    return result if result else ["No relevant information could be retrieved for this section."]


def _jaccard(a: str, b: str) -> float:
    wa, wb = set(a.lower().split()), set(b.lower().split())
    return len(wa & wb) / len(wa | wb) if (wa or wb) else 0.0


# ── 7. PDF Generation ─────────────────────────────────────────────────────────

def build_pdf(sections_content: list, output_path: str):
    """Generate the structured summary PDF with reportlab."""
    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        "DocTitle",
        parent=styles["Title"],
        fontSize=18,
        textColor=colors.HexColor("#1e3a5f"),
        spaceAfter=4,
        fontName="Helvetica-Bold",
    )
    subtitle_style = ParagraphStyle(
        "DocSubtitle",
        parent=styles["Normal"],
        fontSize=9,
        textColor=colors.HexColor("#64748b"),
        spaceAfter=12,
    )
    heading_style = ParagraphStyle(
        "SectionHeading",
        parent=styles["Heading2"],
        fontSize=12,
        textColor=colors.HexColor("#1e40af"),
        spaceBefore=16,
        spaceAfter=7,
        fontName="Helvetica-Bold",
    )
    bullet_style = ParagraphStyle(
        "BulletText",
        parent=styles["Normal"],
        fontSize=9.5,
        textColor=colors.HexColor("#1e293b"),
        leftIndent=18,
        firstLineIndent=-12,
        leading=15,
        spaceAfter=6,
        wordWrap="LTR",
    )
    footer_style = ParagraphStyle(
        "Footer",
        parent=styles["Normal"],
        fontSize=7,
        textColor=colors.HexColor("#94a3b8"),
    )

    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=2.2 * cm,
        rightMargin=2.2 * cm,
        topMargin=1.8 * cm,
        bottomMargin=1.8 * cm,
    )

    story = []

    # Header
    story.append(Paragraph("AlphaSense \u2013 Financial Document Summary", title_style))
    story.append(Paragraph(
        "AI-generated RAG-powered structured summary \u00b7 For reference only",
        subtitle_style
    ))
    story.append(HRFlowable(
        width="100%", thickness=2,
        color=colors.HexColor("#1e40af"), spaceAfter=10
    ))

    for sec in sections_content:
        block = []
        block.append(Paragraph(sec["title"], heading_style))
        for bullet in sec["bullets"]:
            # Escape XML special chars for reportlab
            safe = (bullet
                    .replace("&", "&amp;")
                    .replace("<", "&lt;")
                    .replace(">", "&gt;"))
            block.append(Paragraph(f"\u2022\u00a0 {safe}", bullet_style))
        block.append(Spacer(1, 4))
        story.append(KeepTogether(block))

    # Footer
    story.append(Spacer(1, 12))
    story.append(HRFlowable(
        width="100%", thickness=0.5,
        color=colors.HexColor("#cbd5e1"), spaceAfter=4
    ))
    story.append(Paragraph(
        "Generated by AlphaSense RAG Summarizer \u00b7 Powered by SentenceTransformers + FAISS",
        footer_style
    ))

    doc.build(story)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print("Usage: python rag_summarize.py <pdf_path>", file=sys.stderr)
        sys.exit(1)

    pdf_path = sys.argv[1]
    output_path = pdf_path.replace(".pdf", "_summary.pdf")

    # Step 1 — Extract text
    print("Extracting text from PDF...", flush=True)
    raw_text = extract_text(pdf_path)
    if not raw_text.strip():
        print("Error: No text could be extracted from this PDF.", file=sys.stderr)
        sys.exit(1)
    text = clean_text(raw_text)

    # Step 2 — Chunk
    print("Chunking text...", flush=True)
    chunks = chunk_text(text)
    if not chunks:
        print("Error: Document too short to process.", file=sys.stderr)
        sys.exit(1)
    print(f"  {len(chunks)} chunks created.", flush=True)

    # Step 3 — Embed
    print("Loading embedding model...", flush=True)
    model = SentenceTransformer(MODEL_NAME)
    print("Generating embeddings...", flush=True)
    index = build_index(chunks, model)

    # Step 4 — Retrieve & generate per section
    print("Retrieving relevant sections...", flush=True)
    sections_content = []
    used_globally: list = []   # cross-section dedup pool
    for sec in SECTIONS:
        retrieved = retrieve(sec["query"], index, chunks, model, top_k=TOP_K)
        bullets = extract_bullets(
            retrieved,
            sec["bullets"],
            used_globally,
            requires_numbers=sec.get("requires_numbers", False),
        )
        sections_content.append({"title": sec["title"], "bullets": bullets})
        print(f"  {sec['title']} — {len(bullets)} bullets", flush=True)

    # Step 5 — Build PDF
    print("Generating summary PDF...", flush=True)
    build_pdf(sections_content, output_path)
    print(f"Summary saved to {output_path}", flush=True)
    sys.exit(0)


if __name__ == "__main__":
    main()
