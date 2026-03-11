"""
rag_summarize.py  —  AlphaSense RAG-powered Financial PDF Summarizer
Pipeline: extract → chunk → embed (SentenceTransformers) → FAISS index
         → section-specific retrieval → structured summary PDF (reportlab)
"""

import sys
import re
import textwrap
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
CHUNK_SIZE   = 800   # target tokens per chunk (approx words)
CHUNK_OVERLAP = 120  # overlap tokens
TOP_K        = 6     # chunks retrieved per section
MODEL_NAME   = "all-MiniLM-L6-v2"

# Financial section queries — used to retrieve the most relevant chunks
SECTIONS = [
    {
        "title": "1. Executive Summary",
        "query": "executive summary overview company business operations annual report",
        "bullets": 5,
    },
    {
        "title": "2. Financial Highlights",
        "query": "financial highlights key figures earnings revenue profit loss quarterly annual",
        "bullets": 6,
    },
    {
        "title": "3. Revenue & Profit Overview",
        "query": "revenue net profit gross margin EBITDA income operating profit growth percentage",
        "bullets": 6,
    },
    {
        "title": "4. Key Risks & Challenges",
        "query": "risks challenges uncertainties market risk regulatory compliance debt liquidity",
        "bullets": 5,
    },
    {
        "title": "5. Strategic Initiatives",
        "query": "strategy initiatives investments expansion acquisitions partnerships innovation",
        "bullets": 5,
    },
    {
        "title": "6. Future Outlook",
        "query": "outlook guidance forecast future targets growth projections next year",
        "bullets": 5,
    },
]


# ── 1. PDF Text Extraction ───────────────────────────────────────────────────

def extract_text(pdf_path: str) -> str:
    """Extract full text from PDF using pdfplumber (handles multi-column layouts)."""
    pages_text = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text(x_tolerance=3, y_tolerance=3)
            if text:
                pages_text.append(text)
    return "\n".join(pages_text)


def clean_text(text: str) -> str:
    """Remove noise: excessive whitespace, non-ASCII junk, repeated dashes."""
    text = re.sub(r'[^\x20-\x7E\n]', ' ', text)
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r'-{3,}', '', text)
    text = re.sub(r'\.{3,}', '...', text)
    return text.strip()


# ── 2. Chunking ──────────────────────────────────────────────────────────────

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


# ── 3. Embedding & FAISS Index ───────────────────────────────────────────────

def build_index(chunks: list, model: SentenceTransformer):
    """Embed all chunks and build a FAISS flat L2 index."""
    embeddings = model.encode(chunks, show_progress_bar=False, batch_size=32)
    embeddings = np.array(embeddings, dtype="float32")
    faiss.normalize_L2(embeddings)                        # cosine similarity via inner-product
    dim = embeddings.shape[1]
    index = faiss.IndexFlatIP(dim)                        # inner product = cosine after normalisation
    index.add(embeddings)
    return index, embeddings


# ── 4. Retrieval ─────────────────────────────────────────────────────────────

def retrieve(query: str, index, chunks: list, model: SentenceTransformer, top_k: int = TOP_K):
    """Retrieve top-K most relevant chunks for a query."""
    q_emb = model.encode([query], show_progress_bar=False)
    q_emb = np.array(q_emb, dtype="float32")
    faiss.normalize_L2(q_emb)
    _, indices = index.search(q_emb, min(top_k, len(chunks)))
    return [chunks[i] for i in indices[0] if i >= 0]


# ── 5. Bullet extraction from retrieved chunks ───────────────────────────────

_STOPWORDS = set("""a an the and or but in on at to for of with is are was were
    be been being have has had do does did will would could should may might
    that this these those it its by from as up out if into through during
    before after above below between each other than then there when where
    which who whom how all both just because so also can his her their our
    your my we they he she i you""".split())


def extract_bullets(retrieved_chunks: list, n_bullets: int) -> list:
    """
    Split retrieved chunks into sentences, score them, and return the top-N
    as bullet points to go into the summary.
    """
    # Flatten all retrieved text into sentences
    all_text = " ".join(retrieved_chunks)
    # Sentence split
    raw_sentences = re.split(r'(?<=[.!?])\s+(?=[A-Z])', all_text)
    sentences = [s.strip() for s in raw_sentences if len(s.strip()) > 50]

    if not sentences:
        return ["No relevant information could be retrieved for this section."]

    # Score by keyword richness + number presence (financial relevance)
    from collections import Counter
    word_freq = Counter()
    for sent in sentences:
        for w in re.findall(r'\b[a-zA-Z]{3,}\b', sent.lower()):
            if w not in _STOPWORDS:
                word_freq[w] += 1

    scored = []
    for sent in sentences:
        words = re.findall(r'\b[a-zA-Z]{3,}\b', sent.lower())
        score = sum(word_freq.get(w, 0) for w in words if w not in _STOPWORDS)
        if re.search(r'\d', sent):
            score *= 1.4   # boost sentences with numbers
        scored.append((score, sent))

    scored.sort(key=lambda x: -x[0])
    # Deduplicate near-identical sentences
    seen = []
    for _, sent in scored:
        if not any(_similar(sent, s) for s in seen):
            seen.append(sent)
        if len(seen) == n_bullets:
            break

    # Wrap long bullets cleanly
    result = []
    for s in seen:
        if len(s) > 220:
            s = s[:217] + "..."
        result.append(s)
    return result if result else ["No relevant information could be retrieved for this section."]


def _similar(a: str, b: str, threshold: float = 0.7) -> bool:
    """Rough Jaccard similarity check to remove near-duplicate bullets."""
    wa = set(a.lower().split())
    wb = set(b.lower().split())
    if not wa or not wb:
        return False
    return len(wa & wb) / len(wa | wb) > threshold


# ── 6. PDF Generation ────────────────────────────────────────────────────────

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
        fontSize=11,
        textColor=colors.HexColor("#1e40af"),
        spaceBefore=14,
        spaceAfter=6,
        fontName="Helvetica-Bold",
    )
    bullet_style = ParagraphStyle(
        "BulletText",
        parent=styles["Normal"],
        fontSize=9,
        textColor=colors.HexColor("#1e293b"),
        leftIndent=16,
        firstLineIndent=-10,
        leading=14,
        spaceAfter=5,
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
        leftMargin=2.0 * cm,
        rightMargin=2.0 * cm,
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
            safe = bullet.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            block.append(Paragraph(f"\u2022\u00a0 {safe}", bullet_style))
        block.append(Spacer(1, 4))
        story.append(KeepTogether(block))

    # Footer
    story.append(Spacer(1, 10))
    story.append(HRFlowable(
        width="100%", thickness=0.5,
        color=colors.HexColor("#cbd5e1"), spaceAfter=4
    ))
    story.append(Paragraph(
        "Generated by AlphaSense RAG Summarizer \u00b7 Powered by SentenceTransformers + FAISS",
        footer_style
    ))

    doc.build(story)


# ── Main ─────────────────────────────────────────────────────────────────────

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
    index, _ = build_index(chunks, model)

    # Step 4 — Retrieve & generate per section
    print("Retrieving relevant sections...", flush=True)
    sections_content = []
    for sec in SECTIONS:
        retrieved = retrieve(sec["query"], index, chunks, model, top_k=TOP_K)
        bullets = extract_bullets(retrieved, sec["bullets"])
        sections_content.append({"title": sec["title"], "bullets": bullets})
        print(f"  {sec['title']} — {len(bullets)} bullets", flush=True)

    # Step 5 — Build PDF
    print("Generating summary PDF...", flush=True)
    build_pdf(sections_content, output_path)
    print(f"Summary saved to {output_path}", flush=True)
    sys.exit(0)


if __name__ == "__main__":
    main()
