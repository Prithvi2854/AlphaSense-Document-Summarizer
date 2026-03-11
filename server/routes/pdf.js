import express from "express"
import multer from "multer"
import { spawn } from "child_process"
import fs from "fs"
import path from "path"
import File from "../models/File.js"

// ── chat helper: extract text lines from a PDF summary text file ──────────────
function extractTextFromFile(filePath) {
  try {
    // Try to read raw bytes and decode printable ASCII — works for ReportLab PDFs
    const buf = fs.readFileSync(filePath)
    const raw = buf.toString("latin1")
    // Pull out printable ASCII runs (≥4 chars)
    const chunks = raw.match(/[\x20-\x7E]{4,}/g) || []
    return chunks.join(" ")
  } catch {
    return ""
  }
}

function splitSentences(text) {
  const parts = text.split(/(?<=[.!?])\s+(?=[A-Z])/).map(s => s.trim())
  return parts.filter(s => s.length > 30)
}

function scoreAndAnswer(question, sentences) {
  const stopwords = new Set("a an the and or but in on at to for of with is are was were be been being have has had do does did will would could should may might that this these those it its by from as up out if into through during before after above below between each other than then there when where which who whom how all both just because so also can his her their our your my we they he she i you".split(" "))

  const qWords = question.toLowerCase().match(/[a-zA-Z]{3,}/g) || []
  const qKeywords = qWords.filter(w => !stopwords.has(w))

  // Section keyword shortcuts
  const sectionMap = [
    { keywords: ["executive", "overview", "summary"], heading: "Executive Summary" },
    { keywords: ["highlight", "key", "important", "notable"], heading: "Key Highlights" },
    { keywords: ["metric", "financial", "data", "number", "figure", "revenue", "profit", "loss", "growth", "percent", "%"], heading: "Financial Metrics" },
    { keywords: ["conclusion", "conclud", "result", "outcome", "final"], heading: "Conclusion" },
  ]

  for (const sec of sectionMap) {
    const hit = sec.keywords.some(k => question.toLowerCase().includes(k))
    if (hit) {
      const relevant = sentences.filter(s =>
        sec.keywords.some(k => s.toLowerCase().includes(k))
      )
      if (relevant.length > 0) return relevant.slice(0, 5).join(" ")
    }
  }

  // Generic TF-based scoring
  const scored = sentences.map(sent => {
    const words = (sent.toLowerCase().match(/[a-zA-Z]{3,}/g) || []).filter(w => !stopwords.has(w))
    const score = qKeywords.reduce((acc, k) => acc + (words.includes(k) ? 2 : 0) + words.filter(w => w.includes(k)).length, 0)
    return { sent, score }
  }).filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)

  if (scored.length === 0) {
    return "I couldn't find a specific answer in the document. Try asking about the executive summary, key highlights, financial metrics, or conclusion."
  }
  return scored.slice(0, 4).map(x => x.sent).join(" ")
}

const upload = multer({ limits: { fileSize: 500 * 1024 * 1024 } })
const router = express.Router()

const serverDir = process.cwd()
const uploadsDir = path.join(serverDir, "uploads")

// Ensure uploads directory exists
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}

// POST /upload - upload and summarise a PDF
router.post("/upload", upload.single("pdf"), async (req, res) => {
  try {
    const timestamp = Date.now()
    const fileName = `${timestamp}.pdf`
    const filePath = path.join(uploadsDir, fileName)

    fs.writeFileSync(filePath, req.file.buffer)

    const summaryFileName = `${timestamp}_summary.pdf`
    const summaryPath = path.join(uploadsDir, summaryFileName)
    const originalName = req.body.originalName || req.file.originalname || fileName

    return new Promise((resolve) => {
      console.log("Starting Python summarization...")
      console.log("Input file:", filePath)
      console.log("Output file:", summaryPath)

      const py = spawn("python", [
        path.join(serverDir, "..", "python", "summarize.py"),
        filePath
      ], {
        cwd: serverDir,
        stdio: ["pipe", "pipe", "pipe"]
      })

      let stdoutOutput = ""
      let stderrOutput = ""

      py.stdout.on("data", (data) => {
        stdoutOutput += data.toString()
        console.log("Python stdout:", data.toString())
      })

      py.stderr.on("data", (data) => {
        stderrOutput += data.toString()
        console.error("Python stderr:", data.toString())
      })

      py.on("error", (err) => {
        console.error("Python process error:", err)
        res.status(500).json({ error: "Failed to start Python process", details: err.message })
        resolve()
      })

      py.on("close", async (code) => {
        console.log("Python process closed with code:", code)

        if (code !== 0) {
          console.error("Python error:", stderrOutput)
          return res.status(500).json({ error: "Summarization failed", details: stderrOutput })
        }

        setTimeout(async () => {
          if (!fs.existsSync(summaryPath)) {
            console.error("Summary file not created at:", summaryPath)
            return res.status(500).json({ error: "Summary file was not created" })
          }

          try {
            const record = await File.create({
              originalName,
              originalPdf: fileName,
              summaryPdf: summaryFileName
            })
            res.json(record)
            resolve()
          } catch (dbError) {
            console.error("Database error:", dbError)
            res.status(500).json({ error: "Failed to save file record" })
            resolve()
          }
        }, 1000)
      })
    })
  } catch (error) {
    console.error("Upload error:", error)
    res.status(500).json({ error: error.message })
  }
})

// DELETE /api/pdf/:id - remove a record from history
router.delete("/:id", async (req, res) => {
  try {
    await File.findByIdAndDelete(req.params.id)
    res.json({ success: true })
  } catch (error) {
    console.error("Delete error:", error)
    res.status(500).json({ error: error.message })
  }
})

// GET /history - return all uploaded files, newest first
router.get("/history", async (req, res) => {
  try {
    const files = await File.find().sort({ createdAt: -1 }).limit(50)
    res.json(files)
  } catch (error) {
    console.error("History error:", error)
    res.status(500).json({ error: error.message })
  }
})

// GET /download - download a file by filename
router.get("/download", (req, res) => {
  try {
    const filePath = path.join(uploadsDir, req.query.path)

    // Security: prevent directory traversal
    if (!filePath.startsWith(uploadsDir)) {
      return res.status(403).json({ error: "Access denied" })
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" })
    }

    res.download(filePath)
  } catch (error) {
    console.error("Download error:", error)
    res.status(500).json({ error: error.message })
  }
})

// POST /chat - answer a question about an uploaded summary PDF
router.post("/chat", async (req, res) => {
  try {
    const { filename, question } = req.body

    if (!filename || !question) {
      return res.status(400).json({ error: "filename and question are required" })
    }

    const filePath = path.join(uploadsDir, filename)
    if (!filePath.startsWith(uploadsDir)) {
      return res.status(403).json({ error: "Access denied" })
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Summary file not found" })
    }

    const text = extractTextFromFile(filePath)
    if (!text.trim()) {
      return res.json({ answer: "I wasn't able to read the document content. Please try re-uploading your PDF." })
    }

    const sentences = splitSentences(text)
    const answer = scoreAndAnswer(question, sentences)

    res.json({ answer })
  } catch (error) {
    console.error("Chat error:", error)
    res.status(500).json({ error: error.message })
  }
})

export default router
