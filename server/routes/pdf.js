import express from "express"
import multer from "multer"
import { spawn } from "child_process"
import fs from "fs"
import path from "path"
import File from "../models/File.js"

// ── helpers ───────────────────────────────────────────────────────────────────
// Python executable inside the project .venv
const PYTHON_BIN = path.join(process.cwd(), "..", ".venv", "Scripts", "python.exe")



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

      const py = spawn(PYTHON_BIN, [
        path.join(serverDir, "..", "python", "rag_summarize.py"),
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

// POST /chat - RAG-powered Q&A using the original uploaded PDF
router.post("/chat", async (req, res) => {
  try {
    const { filename, question } = req.body

    if (!filename || !question) {
      return res.status(400).json({ error: "filename and question are required" })
    }

    // filename here is the originalPdf (e.g. "1234567890.pdf"), not the summary
    const originalFilename = filename.replace("_summary.pdf", ".pdf")
    const filePath = path.join(uploadsDir, originalFilename)
    if (!filePath.startsWith(uploadsDir)) {
      return res.status(403).json({ error: "Access denied" })
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Original PDF not found" })
    }

    return new Promise((resolve) => {
      const py = spawn(PYTHON_BIN, [
        path.join(serverDir, "..", "python", "rag_chat.py"),
        filePath,
        question
      ], {
        cwd: serverDir,
        stdio: ["pipe", "pipe", "pipe"]
      })

      let stdout = ""
      let stderr = ""

      py.stdout.on("data", (d) => { stdout += d.toString() })
      py.stderr.on("data", (d) => { stderr += d.toString() })

      py.on("close", (code) => {
        try {
          const parsed = JSON.parse(stdout.trim())
          if (parsed.answer) {
            res.json({ answer: parsed.answer })
          } else {
            res.json({ answer: parsed.error || "Could not generate an answer." })
          }
        } catch {
          console.error("RAG chat parse error:", stderr)
          res.json({ answer: "I had trouble processing that question. Please try again." })
        }
        resolve()
      })

      py.on("error", (err) => {
        console.error("RAG chat process error:", err)
        res.json({ answer: "Chat service is unavailable right now." })
        resolve()
      })
    })
  } catch (error) {
    console.error("Chat error:", error)
    res.status(500).json({ error: error.message })
  }
})

export default router
