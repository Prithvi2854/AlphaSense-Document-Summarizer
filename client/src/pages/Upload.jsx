import { useState, useCallback, useRef } from "react"
import { useNavigate } from "react-router-dom"
import axios from "axios"
import Chatbot from "../components/Chatbot"

const STEPS = [
    { id: 1, label: "Uploading file...", icon: "⬆️" },
    { id: 2, label: "Extracting text from PDF...", icon: "📄" },
    { id: 3, label: "Analysing content with AI...", icon: "🤖" },
    { id: 4, label: "Generating structured summary...", icon: "✍️" },
    { id: 5, label: "Finalising your document...", icon: "📦" },
]

export default function Upload() {
    const navigate = useNavigate()
    const [file, setFile] = useState(null)
    const [dragging, setDragging] = useState(false)
    const [loading, setLoading] = useState(false)
    const [currentStep, setCurrentStep] = useState(0)
    const [summary, setSummary] = useState(null)
    const [error, setError] = useState(null)
    const timeoutRefs = useRef([])

    const clearAllTimeouts = () => {
        timeoutRefs.current.forEach(clearTimeout)
        timeoutRefs.current = []
    }

    const handleFile = (f) => {
        if (f && f.type === "application/pdf") {
            setFile(f)
            setError(null)
            setSummary(null)
            setCurrentStep(0)
        } else {
            setError("Please select a valid PDF file.")
        }
    }

    const onDrop = useCallback((e) => {
        e.preventDefault()
        setDragging(false)
        handleFile(e.dataTransfer.files[0])
    }, [])

    const onDragOver = useCallback((e) => {
        e.preventDefault()
        setDragging(true)
    }, [])

    const onDragLeave = useCallback(() => {
        setDragging(false)
    }, [])

    const formatSize = (bytes) => {
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    }

    const simulateSteps = () => {
        clearAllTimeouts()
        const delays = [0, 3000, 8000, 15000, 22000]
        delays.forEach((delay, idx) => {
            const t = setTimeout(() => {
                setCurrentStep(idx + 1)
            }, delay)
            timeoutRefs.current.push(t)
        })
    }

    const handleDownload = () => {
        const url = `http://localhost:5000/api/pdf/download?path=${summary}`
        const link = document.createElement("a")
        link.href = url
        link.setAttribute("download", "summary.pdf")
        link.setAttribute("target", "_blank")
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
    }

    const handleSummarise = async () => {
        if (!file) {
            setError("Please select a PDF file first.")
            return
        }

        setLoading(true)
        setError(null)
        setSummary(null)
        simulateSteps()

        try {
            const form = new FormData()
            form.append("pdf", file)
            form.append("originalName", file.name)

            const res = await axios.post("http://localhost:5000/api/pdf/upload", form, {
                timeout: 300000,
            })

            clearAllTimeouts()
            setSummary(res.data.summaryPdf)
            setCurrentStep(6)
        } catch (err) {
            clearAllTimeouts()
            setError(err.response?.data?.error || err.message || "Upload failed. Please try again.")
            setCurrentStep(0)
        } finally {
            setLoading(false)
        }
    }

    const isDone = currentStep === 6

    return (
        <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", flexDirection: "column" }}>

            {/* Navbar */}
            <nav style={{
                background: "white",
                borderBottom: "1px solid #e2e8f0",
                padding: "16px 24px",
                display: "flex",
                alignItems: "center",
                gap: "16px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
            }}>
                <button
                    onClick={() => navigate("/")}
                    style={{
                        display: "flex", alignItems: "center", gap: "6px",
                        color: "#64748b", background: "none", border: "none",
                        cursor: "pointer", fontSize: "14px", fontWeight: 500,
                        padding: "6px 10px", borderRadius: "6px",
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = "#1e293b"}
                    onMouseLeave={e => e.currentTarget.style.color = "#64748b"}
                >
                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    Back
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{
                        width: "30px", height: "30px", background: "#2563eb", borderRadius: "8px",
                        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
                    }}>
                        <svg width="16" height="16" fill="none" stroke="white" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                    </div>
                    <span style={{ fontSize: "18px", fontWeight: 700, color: "#1e293b" }}>AlphaSense</span>
                </div>
            </nav>

            {/* Main Content */}
            <div style={{ flex: 1, display: "flex", justifyContent: "center", padding: "48px 16px" }}>
                <div style={{ width: "100%", maxWidth: "560px" }}>

                    <div style={{ textAlign: "center", marginBottom: "32px" }}>
                        <h1 style={{ fontSize: "28px", fontWeight: 800, color: "#1e293b", margin: "0 0 8px" }}>
                            Upload Your PDF
                        </h1>
                        <p style={{ color: "#64748b", fontSize: "15px", margin: 0 }}>
                            Get a structured 2-page AI summary of any financial document
                        </p>
                    </div>

                    <div style={{
                        background: "white", borderRadius: "16px",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.08)", border: "1px solid #e2e8f0", padding: "32px"
                    }}>

                        {/* Drop Zone */}
                        <div
                            onDrop={onDrop}
                            onDragOver={onDragOver}
                            onDragLeave={onDragLeave}
                            onClick={() => !loading && document.getElementById("file-input").click()}
                            style={{
                                border: `2px dashed ${dragging ? "#3b82f6" : file ? "#22c55e" : "#cbd5e1"}`,
                                borderRadius: "12px",
                                padding: "40px 20px",
                                textAlign: "center",
                                cursor: loading ? "not-allowed" : "pointer",
                                background: dragging ? "#eff6ff" : file ? "#f0fdf4" : "#f8fafc",
                                transition: "all 0.2s",
                                opacity: loading ? 0.7 : 1,
                            }}
                        >
                            <input
                                id="file-input"
                                type="file"
                                accept=".pdf"
                                style={{ display: "none" }}
                                onChange={(e) => handleFile(e.target.files[0])}
                            />

                            {file ? (
                                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                                    <div style={{
                                        width: "48px", height: "48px", background: "#dcfce7", borderRadius: "50%",
                                        display: "flex", alignItems: "center", justifyContent: "center"
                                    }}>
                                        <svg width="24" height="24" fill="none" stroke="#16a34a" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                    </div>
                                    <p style={{ fontWeight: 600, color: "#1e293b", fontSize: "14px", margin: 0 }}>{file.name}</p>
                                    <p style={{ color: "#94a3b8", fontSize: "12px", margin: 0 }}>{formatSize(file.size)} · PDF</p>
                                    {!loading && <p style={{ color: "#94a3b8", fontSize: "12px", margin: 0 }}>Click to change file</p>}
                                </div>
                            ) : (
                                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                                    <div style={{
                                        width: "48px", height: "48px", background: "#eff6ff", borderRadius: "50%",
                                        display: "flex", alignItems: "center", justifyContent: "center"
                                    }}>
                                        <svg width="24" height="24" fill="none" stroke="#3b82f6" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                        </svg>
                                    </div>
                                    <p style={{ fontWeight: 600, color: "#334155", margin: "0" }}>
                                        {dragging ? "Drop your PDF here" : "Drag & drop your PDF here"}
                                    </p>
                                    <p style={{ color: "#94a3b8", fontSize: "14px", margin: 0 }}>or click to browse files</p>
                                    <span style={{
                                        background: "#f1f5f9", color: "#64748b", fontSize: "12px",
                                        padding: "4px 12px", borderRadius: "999px"
                                    }}>PDF files only</span>
                                </div>
                            )}
                        </div>

                        {/* Error */}
                        {error && (
                            <div style={{
                                marginTop: "16px", padding: "12px 14px", background: "#fef2f2",
                                border: "1px solid #fecaca", borderRadius: "8px",
                                display: "flex", alignItems: "flex-start", gap: "8px"
                            }}>
                                <svg width="16" height="16" fill="#ef4444" viewBox="0 0 20 20" style={{ flexShrink: 0, marginTop: "2px" }}>
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                </svg>
                                <p style={{ color: "#b91c1c", fontSize: "14px", margin: 0 }}>{error}</p>
                            </div>
                        )}

                        {/* Summarise Button */}
                        <button
                            className="up-summarise-btn"
                            onClick={handleSummarise}
                            disabled={loading || !file}
                            style={{
                                marginTop: "20px",
                                width: "100%",
                                padding: "14px",
                                borderRadius: "12px",
                                fontWeight: 700,
                                fontSize: "15px",
                                border: "none",
                                cursor: loading || !file ? "not-allowed" : "pointer",
                                background: loading || !file ? "#e2e8f0" : "#2563eb",
                                color: loading || !file ? "#94a3b8" : "white",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "8px",
                                transition: "background 0.2s",
                            }}
                        >
                            {loading ? (
                                <>
                                    <div style={{
                                        width: "16px", height: "16px",
                                        border: "2px solid rgba(255,255,255,0.3)",
                                        borderTop: "2px solid white",
                                        borderRadius: "50%",
                                        animation: "spin 0.8s linear infinite"
                                    }} />
                                    Processing...
                                </>
                            ) : (
                                <>
                                    <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                    Summarise
                                </>
                            )}
                        </button>

                        {/* Progress Steps */}
                        {loading && (
                            <div style={{ marginTop: "24px" }}>
                                <p style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "12px" }}>
                                    Progress
                                </p>
                                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                    {STEPS.map((step) => {
                                        const isActive = currentStep === step.id
                                        const isDoneStep = currentStep > step.id
                                        return (
                                            <div key={step.id} style={{
                                                display: "flex", alignItems: "center", gap: "12px",
                                                padding: "10px 14px", borderRadius: "8px",
                                                background: isActive ? "#eff6ff" : isDoneStep ? "#f0fdf4" : "#f8fafc",
                                                border: `1px solid ${isActive ? "#bfdbfe" : isDoneStep ? "#bbf7d0" : "#f1f5f9"}`,
                                                opacity: !isActive && !isDoneStep ? 0.5 : 1,
                                                transition: "all 0.3s"
                                            }}>
                                                <span style={{ fontSize: "16px", lineHeight: 1 }}>
                                                    {isDoneStep ? "✅" : isActive ? step.icon : "⏳"}
                                                </span>
                                                <span style={{
                                                    fontSize: "13px", fontWeight: 500,
                                                    color: isActive ? "#1d4ed8" : isDoneStep ? "#15803d" : "#94a3b8",
                                                    flex: 1
                                                }}>
                                                    {step.label}
                                                </span>
                                                {isActive && (
                                                    <div style={{
                                                        width: "14px", height: "14px",
                                                        border: "2px solid #bfdbfe",
                                                        borderTop: "2px solid #2563eb",
                                                        borderRadius: "50%",
                                                        animation: "spin 0.8s linear infinite"
                                                    }} />
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Success */}
                        {isDone && summary && (
                            <div style={{
                                marginTop: "24px", padding: "20px",
                                background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "12px"
                            }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
                                    <div style={{
                                        width: "32px", height: "32px", background: "#dcfce7", borderRadius: "50%",
                                        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
                                    }}>
                                        <svg width="16" height="16" fill="none" stroke="#16a34a" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                    </div>
                                    <div>
                                        <p style={{ fontWeight: 700, color: "#15803d", fontSize: "14px", margin: 0 }}>Summary Ready!</p>
                                        <p style={{ color: "#16a34a", fontSize: "12px", margin: 0 }}>Your 2-page structured summary has been generated.</p>
                                    </div>
                                </div>

                                <button
                                    className="up-download-btn"
                                    onClick={handleDownload}
                                    style={{
                                        width: "100%", padding: "12px",
                                        background: "#16a34a", color: "white",
                                        border: "none", borderRadius: "8px",
                                        fontWeight: 700, fontSize: "14px",
                                        cursor: "pointer",
                                        display: "flex", alignItems: "center", justifyContent: "center", gap: "8px"
                                    }}
                                >
                                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                    </svg>
                                    Download Summary PDF
                                </button>

                                <button
                                    className="up-back-dash-btn"
                                    onClick={() => navigate("/")}
                                    style={{
                                        marginTop: "8px", width: "100%", padding: "10px",
                                        background: "none", border: "none",
                                        color: "#64748b", fontSize: "13px", fontWeight: 500,
                                        cursor: "pointer"
                                    }}
                                >
                                    ← Back to Dashboard
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }

          .up-drop-zone { transition: border-color 0.2s, background 0.2s, transform 0.15s; }
          .up-drop-zone:hover:not(.loading) { transform: scale(1.005); }

          .up-back-btn {
            display: flex; align-items: center; gap: 6px;
            color: #64748b; background: none; border: none;
            cursor: pointer; font-size: 14px; font-weight: 500;
            padding: 6px 10px; border-radius: 6px;
            transition: color 0.15s, background 0.15s;
          }
          .up-back-btn:hover { color: #1e293b; background: #f1f5f9; }

          .up-summarise-btn {
            transition: background 0.18s, transform 0.15s, box-shadow 0.18s !important;
          }
          .up-summarise-btn:not([disabled]):hover {
            background: #1d4ed8 !important;
            transform: translateY(-1px);
            box-shadow: 0 6px 16px rgba(37,99,235,0.4) !important;
          }
          .up-summarise-btn:not([disabled]):active { transform: translateY(0); }

          .up-download-btn {
            transition: background 0.18s, transform 0.15s, box-shadow 0.18s !important;
          }
          .up-download-btn:hover {
            background: #15803d !important;
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(22,163,74,0.4) !important;
          }
          .up-download-btn:active { transform: translateY(0); }

          .up-back-dash-btn {
            transition: color 0.15s, background 0.15s !important;
            border-radius: 6px !important;
          }
          .up-back-dash-btn:hover { color: #1e293b !important; background: #f1f5f9 !important; }
        `}</style>

            {/* Floating AI Chatbot — available whenever a summary exists */}
            {summary && <Chatbot summaryPdf={summary} />}
        </div>
    )
}
