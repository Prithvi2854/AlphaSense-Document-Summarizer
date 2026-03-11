import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import axios from "axios"

export default function Home() {
    const navigate = useNavigate()
    const [history, setHistory] = useState([])
    const [loadingHistory, setLoadingHistory] = useState(true)
    const [deletingId, setDeletingId] = useState(null)

    useEffect(() => { fetchHistory() }, [])

    const fetchHistory = async () => {
        setLoadingHistory(true)
        try {
            const res = await axios.get("http://localhost:5000/api/pdf/history")
            setHistory(res.data)
        } catch (err) {
            console.error("Failed to fetch history:", err)
        } finally {
            setLoadingHistory(false)
        }
    }

    const handleDelete = async (id) => {
        setDeletingId(id)
        try {
            await axios.delete(`http://localhost:5000/api/pdf/${id}`)
            setHistory((prev) => prev.filter((item) => item._id !== id))
        } catch (err) {
            console.error("Delete failed:", err)
        } finally {
            setDeletingId(null)
        }
    }

    const handleDownload = (summaryPdf, name) => {
        const url = `http://localhost:5000/api/pdf/download?path=${summaryPdf}`
        const link = document.createElement("a")
        link.href = url
        link.setAttribute("download", `${name}_summary.pdf`)
        link.setAttribute("target", "_blank")
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
    }

    const formatDate = (dateStr) => new Date(dateStr).toLocaleDateString("en-IN", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    })

    const getDisplayName = (item) => {
        if (item.originalName && !item.originalName.match(/^\d{13}\.pdf$/)) return item.originalName
        return item.originalPdf || "document.pdf"
    }

    return (
        <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", flexDirection: "column" }}>

            {/* Navbar */}
            <nav style={{
                background: "white", borderBottom: "1px solid #e2e8f0",
                padding: "16px 24px", display: "flex", alignItems: "center",
                justifyContent: "space-between", boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{
                        width: "32px", height: "32px", background: "#2563eb", borderRadius: "8px",
                        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
                    }}>
                        <svg width="17" height="17" fill="none" stroke="white" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                    </div>
                    <span style={{ fontSize: "20px", fontWeight: 800, color: "#1e293b" }}>AlphaSense</span>
                </div>

                <button className="btn-primary" onClick={() => navigate("/upload")}>
                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    Upload PDF
                </button>
            </nav>

            {/* Hero */}
            <div style={{
                background: "linear-gradient(135deg, #2563eb 0%, #4338ca 100%)",
                padding: "48px 24px", textAlign: "center"
            }}>
                <h1 style={{ fontSize: "32px", fontWeight: 800, color: "white", margin: "0 0 10px" }}>
                    AI-Powered Financial PDF Summarizer
                </h1>
                <p style={{ color: "#bfdbfe", fontSize: "16px", margin: "0 0 28px" }}>
                    Upload any financial document and get a clean, structured AI-powered summary in seconds.
                </p>
                <button className="btn-hero" onClick={() => navigate("/upload")}>
                    <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    Upload a PDF
                </button>
            </div>

            {/* History */}
            <div style={{ flex: 1, maxWidth: "1100px", margin: "0 auto", width: "100%", padding: "40px 24px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
                    <h2 style={{ fontSize: "22px", fontWeight: 700, color: "#1e293b", margin: 0 }}>Document History</h2>
                    <button className="btn-refresh" onClick={fetchHistory}>
                        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Refresh
                    </button>
                </div>

                {loadingHistory ? (
                    <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
                            <div className="spinner" />
                            <p style={{ color: "#64748b", fontSize: "14px", margin: 0 }}>Loading history...</p>
                        </div>
                    </div>

                ) : history.length === 0 ? (
                    <div style={{
                        background: "white", borderRadius: "16px", border: "1px solid #e2e8f0",
                        padding: "64px 24px", textAlign: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.05)"
                    }}>
                        <div style={{
                            width: "56px", height: "56px", background: "#f1f5f9", borderRadius: "50%",
                            display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px"
                        }}>
                            <svg width="26" height="26" fill="none" stroke="#94a3b8" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                        </div>
                        <p style={{ fontWeight: 600, color: "#475569", fontSize: "15px", margin: "0 0 6px" }}>No documents yet</p>
                        <p style={{ color: "#94a3b8", fontSize: "13px", margin: "0 0 20px" }}>Upload a PDF to get started</p>
                        <button className="btn-primary" onClick={() => navigate("/upload")}>Upload your first PDF</button>
                    </div>

                ) : (
                    <div style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                        gap: "16px"
                    }}>
                        {history.map((item) => {
                            const displayName = getDisplayName(item)
                            return (
                                <div key={item._id} className="history-card">
                                    <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                                        <div style={{
                                            width: "40px", height: "40px", background: "#fef2f2", borderRadius: "10px",
                                            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
                                        }}>
                                            <svg width="20" height="20" fill="#ef4444" viewBox="0 0 20 20">
                                                <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                                            </svg>
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <p style={{
                                                fontWeight: 600, color: "#1e293b", fontSize: "13px", margin: "0 0 4px",
                                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                                            }}>{displayName}</p>
                                            <p style={{ color: "#94a3b8", fontSize: "11px", margin: 0 }}>{formatDate(item.createdAt)}</p>
                                        </div>
                                    </div>

                                    <div style={{ display: "flex", gap: "8px" }}>
                                        <button
                                            className="btn-download"
                                            onClick={() => handleDownload(item.summaryPdf, displayName.replace(".pdf", ""))}
                                        >
                                            <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                            </svg>
                                            Download
                                        </button>
                                        <button
                                            className="btn-delete"
                                            onClick={() => handleDelete(item._id)}
                                            disabled={deletingId === item._id}
                                            title="Remove from history"
                                        >
                                            {deletingId === item._id ? (
                                                <div className="spinner-sm" />
                                            ) : (
                                                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            {/* Footer */}
            <footer style={{
                background: "#1e293b", color: "white",
                textAlign: "center", padding: "24px", marginTop: "auto"
            }}>
                <p style={{ fontWeight: 700, fontSize: "15px", margin: "0 0 4px" }}>AlphaSense</p>
                <p style={{ color: "#94a3b8", fontSize: "12px", margin: 0 }}>© 2026 AlphaSense. AI-powered PDF Summarizer.</p>
            </footer>

            <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }

        .spinner {
          width: 36px; height: 36px;
          border: 3px solid #bfdbfe; border-top: 3px solid #2563eb;
          border-radius: 50%; animation: spin 0.8s linear infinite;
        }
        .spinner-sm {
          width: 14px; height: 14px;
          border: 2px solid #fca5a5; border-top: 2px solid #dc2626;
          border-radius: 50%; animation: spin 0.8s linear infinite;
          display: inline-block;
        }

        .btn-primary {
          display: inline-flex; align-items: center; gap: 8px;
          background: #2563eb; color: white; border: none;
          padding: 10px 20px; border-radius: 8px;
          font-weight: 600; font-size: 14px; cursor: pointer;
          box-shadow: 0 1px 4px rgba(37,99,235,0.3);
          transition: background 0.18s, transform 0.15s, box-shadow 0.18s;
        }
        .btn-primary:hover {
          background: #1d4ed8;
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(37,99,235,0.4);
        }
        .btn-primary:active { transform: translateY(0); }

        .btn-hero {
          display: inline-flex; align-items: center; gap: 8px;
          background: white; color: #2563eb; border: none;
          padding: 12px 28px; border-radius: 10px;
          font-weight: 700; font-size: 15px; cursor: pointer;
          box-shadow: 0 4px 14px rgba(0,0,0,0.15);
          transition: background 0.18s, transform 0.15s, box-shadow 0.18s;
        }
        .btn-hero:hover {
          background: #eff6ff;
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(0,0,0,0.2);
        }
        .btn-hero:active { transform: translateY(0); }

        .btn-refresh {
          display: flex; align-items: center; gap: 6px;
          background: none; border: 1px solid #e2e8f0;
          color: #2563eb; padding: 7px 14px; border-radius: 7px;
          font-weight: 500; font-size: 13px; cursor: pointer;
          transition: background 0.18s, border-color 0.18s, transform 0.15s;
        }
        .btn-refresh:hover {
          background: #eff6ff; border-color: #bfdbfe;
          transform: translateY(-1px);
        }

        .history-card {
          background: white; border-radius: 14px;
          border: 1px solid #e2e8f0;
          box-shadow: 0 1px 4px rgba(0,0,0,0.05);
          padding: 20px; display: flex; flex-direction: column; gap: 14px;
          transition: box-shadow 0.2s, transform 0.2s, border-color 0.2s;
          cursor: default;
        }
        .history-card:hover {
          box-shadow: 0 8px 24px rgba(0,0,0,0.1);
          transform: translateY(-3px);
          border-color: #bfdbfe;
        }

        .btn-download {
          flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
          background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0;
          padding: 9px 12px; border-radius: 8px;
          font-weight: 600; font-size: 12px; cursor: pointer;
          transition: background 0.18s, border-color 0.18s, transform 0.15s;
        }
        .btn-download:hover {
          background: #dcfce7; border-color: #86efac;
          transform: translateY(-1px);
        }
        .btn-download:active { transform: translateY(0); }

        .btn-delete {
          display: flex; align-items: center; justify-content: center;
          background: #fff5f5; color: #dc2626; border: 1px solid #fecaca;
          padding: 9px 12px; border-radius: 8px; cursor: pointer;
          transition: background 0.18s, border-color 0.18s, transform 0.15s;
        }
        .btn-delete:hover:not(:disabled) {
          background: #fee2e2; border-color: #fca5a5;
          transform: translateY(-1px);
        }
        .btn-delete:disabled { opacity: 0.6; cursor: not-allowed; }
      `}</style>
        </div>
    )
}
