import sys
import re
import fitz
from collections import Counter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib import colors

# ── Fast extractive summarizer (no sumy / no NLTK downloads needed) ──────────

def clean_text(text):
    text = re.sub(r'\s+', ' ', text)
    text = re.sub(r'[^\x20-\x7E\n]', ' ', text)
    return text.strip()

def split_sentences(text):
    # Simple sentence splitter on . ! ? followed by space+capital
    parts = re.split(r'(?<=[.!?])\s+(?=[A-Z])', text)
    sentences = []
    for p in parts:
        p = p.strip()
        if len(p) > 40:          # skip very short fragments
            sentences.append(p)
    return sentences

def score_sentences(sentences, top_n):
    """Score sentences by word frequency (TF-based), return top N in order."""
    if not sentences:
        return []

    # Build word frequency
    stopwords = set("""a an the and or but in on at to for of with is are was were
        be been being have has had do does did will would could should may might
        that this these those it its by from as up out if into through during
        before after above below between each other than then there when where
        which who whom how all both just because so also can his her their our
        your my we they he she i you""".split())

    word_freq = Counter()
    for sent in sentences:
        words = re.findall(r'\b[a-zA-Z]{3,}\b', sent.lower())
        for w in words:
            if w not in stopwords:
                word_freq[w] += 1

    # Score each sentence
    scored = []
    for i, sent in enumerate(sentences):
        words = re.findall(r'\b[a-zA-Z]{3,}\b', sent.lower())
        score = sum(word_freq.get(w, 0) for w in words if w not in stopwords)
        # Slight boost for sentences with numbers (financial relevance)
        if re.search(r'\d', sent):
            score *= 1.3
        scored.append((score, i, sent))

    # Sort by score, take top_n, then re-order by original position
    top = sorted(scored, key=lambda x: -x[0])[:top_n]
    top = sorted(top, key=lambda x: x[1])
    return [s[2] for s in top]

# ── Main ──────────────────────────────────────────────────────────────────────

try:
    pdf_path = sys.argv[1]
    doc = fitz.open(pdf_path)

    full_text = ""
    for page in doc:
        full_text += page.get_text() + "\n"

    full_text = clean_text(full_text)

    if not full_text.strip():
        raise ValueError("No text could be extracted from this PDF.")

    all_sentences = split_sentences(full_text)

    if not all_sentences:
        raise ValueError("Could not parse sentences from the PDF text.")

    total = len(all_sentences)

    # Split into rough thirds for section diversity
    t1 = total // 3
    t2 = 2 * total // 3

    intro_sents   = all_sentences[:t1]
    mid_sents     = all_sentences[t1:t2]
    end_sents     = all_sentences[t2:]

    # Extract sentences per section (~22 total → fits 2 pages)
    exec_sents       = score_sentences(all_sentences, 5)   # top 5 overall
    highlight_sents  = score_sentences(intro_sents, 6)     # top 6 from intro
    metrics_sents    = score_sentences(mid_sents, 6)       # top 6 from middle
    conclusion_sents = score_sentences(end_sents, 5)       # top 5 from end

    # ── Build the PDF ─────────────────────────────────────────────────────────
    output_pdf = pdf_path.replace(".pdf", "_summary.pdf")

    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        "DocTitle",
        parent=styles["Title"],
        fontSize=17,
        textColor=colors.HexColor("#1e3a5f"),
        spaceAfter=3,
        fontName="Helvetica-Bold",
    )
    subtitle_style = ParagraphStyle(
        "DocSubtitle",
        parent=styles["Normal"],
        fontSize=9,
        textColor=colors.HexColor("#64748b"),
        spaceAfter=10,
    )
    heading_style = ParagraphStyle(
        "SectionHeading",
        parent=styles["Heading2"],
        fontSize=11,
        textColor=colors.HexColor("#1e40af"),
        spaceBefore=12,
        spaceAfter=5,
        fontName="Helvetica-Bold",
    )
    body_style = ParagraphStyle(
        "BodyText",
        parent=styles["Normal"],
        fontSize=9,
        textColor=colors.HexColor("#334155"),
        leading=13,
        spaceAfter=4,
    )
    bullet_style = ParagraphStyle(
        "BulletText",
        parent=body_style,
        leftIndent=12,
        spaceAfter=3,
        leading=12,
    )
    footer_style = ParagraphStyle(
        "Footer",
        parent=styles["Normal"],
        fontSize=7,
        textColor=colors.HexColor("#94a3b8"),
    )

    doc_pdf = SimpleDocTemplate(
        output_pdf,
        pagesize=A4,
        leftMargin=2.0 * cm,
        rightMargin=2.0 * cm,
        topMargin=1.8 * cm,
        bottomMargin=1.8 * cm,
    )

    story = []

    # Title
    story.append(Paragraph("AlphaSense \u2013 Financial Document Summary", title_style))
    story.append(Paragraph("AI-generated structured summary \u00b7 Max 2 pages", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=1.5,
                             color=colors.HexColor("#1e40af"), spaceAfter=8))

    # 1. Executive Summary
    story.append(Paragraph("1. Executive Summary", heading_style))
    if exec_sents:
        story.append(Paragraph(" ".join(exec_sents), body_style))
    else:
        story.append(Paragraph("No executive summary could be extracted.", body_style))
    story.append(Spacer(1, 4))

    # 2. Key Highlights
    story.append(Paragraph("2. Key Highlights", heading_style))
    for sent in (highlight_sents or ["No highlights identified."]):
        story.append(Paragraph(f"\u2022 {sent}", bullet_style))
    story.append(Spacer(1, 4))

    # 3. Financial Metrics & Data
    story.append(Paragraph("3. Financial Metrics &amp; Data", heading_style))
    for sent in (metrics_sents or ["No financial metrics identified."]):
        story.append(Paragraph(f"\u2022 {sent}", bullet_style))
    story.append(Spacer(1, 4))

    # 4. Conclusion
    story.append(Paragraph("4. Conclusion", heading_style))
    if conclusion_sents:
        story.append(Paragraph(" ".join(conclusion_sents), body_style))
    else:
        story.append(Paragraph("No conclusion could be extracted.", body_style))

    story.append(Spacer(1, 8))
    story.append(HRFlowable(width="100%", thickness=0.5,
                             color=colors.HexColor("#cbd5e1"), spaceAfter=3))
    story.append(Paragraph(
        "Generated by AlphaSense AI Summarizer \u00b7 Automated summary for reference only.",
        footer_style
    ))

    doc_pdf.build(story)
    print(f"Summary saved to {output_pdf}")
    sys.exit(0)

except Exception as e:
    print(f"Error: {str(e)}", file=sys.stderr)
    sys.exit(1)
