"""
rag_chat.py  —  AlphaSense RAG-powered Q&A
Usage: python rag_chat.py <original_pdf_path> <question>

Pipeline: extract → chunk → embed → FAISS index → retrieve top-K → return answer
"""

import sys
import re
import json
import numpy as np
import pdfplumber
import faiss
from sentence_transformers import SentenceTransformer

CHUNK_SIZE    = 800
CHUNK_OVERLAP = 120
TOP_K         = 5
MODEL_NAME    = "all-MiniLM-L6-v2"


def extract_text(pdf_path: str) -> str:
    pages = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            t = page.extract_text(x_tolerance=3, y_tolerance=3)
            if t:
                pages.append(t)
    return "\n".join(pages)


def clean_text(text: str) -> str:
    text = re.sub(r'[^\x20-\x7E\n]', ' ', text)
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def chunk_text(text: str):
    words = text.split()
    chunks, start = [], 0
    while start < len(words):
        end = min(start + CHUNK_SIZE, len(words))
        chunk = " ".join(words[start:end])
        if len(chunk.strip()) > 60:
            chunks.append(chunk)
        if end == len(words):
            break
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks


def build_index(chunks, model):
    embeddings = model.encode(chunks, show_progress_bar=False, batch_size=32)
    embeddings = np.array(embeddings, dtype="float32")
    faiss.normalize_L2(embeddings)
    dim = embeddings.shape[1]
    index = faiss.IndexFlatIP(dim)
    index.add(embeddings)
    return index


def retrieve(question: str, index, chunks, model, top_k: int = TOP_K):
    q_emb = model.encode([question], show_progress_bar=False)
    q_emb = np.array(q_emb, dtype="float32")
    faiss.normalize_L2(q_emb)
    _, indices = index.search(q_emb, min(top_k, len(chunks)))
    return [chunks[i] for i in indices[0] if i >= 0]


def format_answer(retrieved_chunks: list, question: str) -> str:
    """Format retrieved chunks into a clean, readable answer."""
    all_text = " ".join(retrieved_chunks)
    # Split into sentences
    sentences = re.split(r'(?<=[.!?])\s+(?=[A-Z])', all_text)
    sentences = [s.strip() for s in sentences if len(s.strip()) > 40]

    if not sentences:
        return "I couldn't find specific information about that in the document. Try asking about revenue, profit, risks, strategy, or outlook."

    # Score by query-word overlap
    q_words = set(re.findall(r'\b[a-zA-Z]{3,}\b', question.lower()))
    stopwords = set("a an the and or but in on at to for of with is are was were be been have has had do does did will would could should may might that this it its by from".split())
    q_keywords = q_words - stopwords

    scored = []
    for sent in sentences:
        s_words = set(re.findall(r'\b[a-zA-Z]{3,}\b', sent.lower()))
        overlap = len(q_keywords & s_words)
        # Boost sentences with numbers for financial questions
        num_boost = 1.5 if re.search(r'\d', sent) else 1.0
        scored.append((overlap * num_boost, sent))

    scored.sort(key=lambda x: -x[0])

    # Return top 4 sentences, deduplicated
    seen, result = [], []
    for _, sent in scored:
        if not any(_jaccard(sent, s) > 0.65 for s in seen):
            seen.append(sent)
            result.append(sent)
        if len(result) == 4:
            break

    if not result:
        result = [sentences[0]] if sentences else []

    return " ".join(result) if result else "I couldn't find a specific answer. Please try rephrasing your question."


def _jaccard(a: str, b: str) -> float:
    wa, wb = set(a.lower().split()), set(b.lower().split())
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: rag_chat.py <pdf_path> <question>"}))
        sys.exit(1)

    pdf_path = sys.argv[1]
    question = sys.argv[2]

    try:
        raw = extract_text(pdf_path)
        if not raw.strip():
            print(json.dumps({"answer": "The document appears to be empty or image-based and cannot be read."}))
            sys.exit(0)

        text = clean_text(raw)
        chunks = chunk_text(text)
        if not chunks:
            print(json.dumps({"answer": "The document is too short to process."}))
            sys.exit(0)

        model = SentenceTransformer(MODEL_NAME)
        index = build_index(chunks, model)
        retrieved = retrieve(question, index, chunks, model)
        answer = format_answer(retrieved, question)

        print(json.dumps({"answer": answer}))
        sys.exit(0)

    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
