import { useState, useRef, useEffect } from "react"
import axios from "axios"

const SUGGESTIONS = [
    "What is the executive summary?",
    "What are the key financial highlights?",
    "What is the revenue and profit overview?",
    "What are the key risks and challenges?",
    "What are the strategic initiatives?",
    "What is the future outlook?",
]

export default function Chatbot({ summaryPdf }) {
    const [open, setOpen] = useState(false)
    const [messages, setMessages] = useState([
        {
            role: "assistant",
            text: "👋 Hi! I'm your AlphaSense RAG AI assistant. I've analysed your document — ask me anything about it!",
        },
    ])
    const [input, setInput] = useState("")
    const [loading, setLoading] = useState(false)
    const [showSuggestions, setShowSuggestions] = useState(true)
    const bottomRef = useRef(null)
    const inputRef = useRef(null)

    useEffect(() => {
        if (open && bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: "smooth" })
        }
    }, [messages, open])

    useEffect(() => {
        if (open && inputRef.current) {
            inputRef.current.focus()
        }
    }, [open])

    const sendMessage = async (text) => {
        const question = text || input.trim()
        if (!question) return

        setInput("")
        setShowSuggestions(false)
        setMessages((prev) => [...prev, { role: "user", text: question }])
        setLoading(true)

        try {
            const res = await axios.post("http://localhost:5000/api/pdf/chat", {
                filename: summaryPdf,
                question,
            })
            setMessages((prev) => [
                ...prev,
                { role: "assistant", text: res.data.answer },
            ])
        } catch (err) {
            setMessages((prev) => [
                ...prev,
                {
                    role: "assistant",
                    text: "⚠️ Sorry, I couldn't process your question. Please try again.",
                },
            ])
        } finally {
            setLoading(false)
        }
    }

    const handleKeyDown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            sendMessage()
        }
    }

    return (
        <>
            {/* Floating Button */}
            <button
                onClick={() => setOpen((o) => !o)}
                aria-label="Open AI Chatbot"
                style={{
                    position: "fixed",
                    bottom: "28px",
                    right: "28px",
                    width: "60px",
                    height: "60px",
                    borderRadius: "50%",
                    background: "linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)",
                    border: "none",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 8px 30px rgba(37,99,235,0.45)",
                    zIndex: 9999,
                    transition: "transform 0.2s, box-shadow 0.2s",
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "scale(1.1)"
                    e.currentTarget.style.boxShadow = "0 12px 36px rgba(37,99,235,0.55)"
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "scale(1)"
                    e.currentTarget.style.boxShadow = "0 8px 30px rgba(37,99,235,0.45)"
                }}
            >
                {open ? (
                    <svg width="22" height="22" fill="none" stroke="white" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                ) : (
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="white">
                        <path d="M20 2H4a2 2 0 00-2 2v18l4-4h14a2 2 0 002-2V4a2 2 0 00-2-2zm-2 10H6v-2h12v2zm0-4H6V6h12v2z" />
                    </svg>
                )}
                {/* Pulse ring when closed */}
                {!open && (
                    <span style={{
                        position: "absolute",
                        inset: 0,
                        borderRadius: "50%",
                        background: "rgba(37,99,235,0.3)",
                        animation: "chatPulse 2s infinite",
                    }} />
                )}
            </button>

            {/* Chat Window */}
            {open && (
                <div
                    style={{
                        position: "fixed",
                        bottom: "100px",
                        right: "28px",
                        width: "380px",
                        maxWidth: "calc(100vw - 48px)",
                        height: "520px",
                        borderRadius: "20px",
                        background: "white",
                        boxShadow: "0 24px 80px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.05)",
                        display: "flex",
                        flexDirection: "column",
                        overflow: "hidden",
                        zIndex: 9998,
                        animation: "chatSlideUp 0.28s cubic-bezier(0.34,1.56,0.64,1)",
                    }}
                >
                    {/* Header */}
                    <div style={{
                        background: "linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)",
                        padding: "16px 20px",
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        flexShrink: 0,
                    }}>
                        <div style={{
                            width: "40px",
                            height: "40px",
                            borderRadius: "50%",
                            background: "rgba(255,255,255,0.2)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                        }}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" />
                            </svg>
                        </div>
                        <div>
                            <p style={{ margin: 0, color: "white", fontWeight: 700, fontSize: "15px" }}>
                                AlphaSense AI
                            </p>
                            <p style={{ margin: 0, color: "rgba(255,255,255,0.75)", fontSize: "12px" }}>
                                Ask about your document
                            </p>
                        </div>
                        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{
                                width: "8px", height: "8px", borderRadius: "50%",
                                background: "#4ade80",
                                boxShadow: "0 0 0 2px rgba(74,222,128,0.3)",
                            }} />
                            <span style={{ color: "rgba(255,255,255,0.8)", fontSize: "11px", fontWeight: 600 }}>Online</span>
                        </div>
                    </div>

                    {/* Messages */}
                    <div style={{
                        flex: 1,
                        overflowY: "auto",
                        padding: "16px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px",
                        background: "#f8fafc",
                    }}>
                        {messages.map((msg, i) => (
                            <div
                                key={i}
                                style={{
                                    display: "flex",
                                    justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                                    animation: "chatFadeIn 0.2s ease",
                                }}
                            >
                                {msg.role === "assistant" && (
                                    <div style={{
                                        width: "28px",
                                        height: "28px",
                                        borderRadius: "50%",
                                        background: "linear-gradient(135deg, #2563eb, #7c3aed)",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        flexShrink: 0,
                                        marginRight: "8px",
                                        alignSelf: "flex-end",
                                    }}>
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="white">
                                            <path d="M20 2H4a2 2 0 00-2 2v18l4-4h14a2 2 0 002-2V4a2 2 0 00-2-2z" />
                                        </svg>
                                    </div>
                                )}
                                <div style={{
                                    maxWidth: "75%",
                                    padding: "10px 14px",
                                    borderRadius: msg.role === "user"
                                        ? "18px 18px 4px 18px"
                                        : "18px 18px 18px 4px",
                                    background: msg.role === "user"
                                        ? "linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)"
                                        : "white",
                                    color: msg.role === "user" ? "white" : "#1e293b",
                                    fontSize: "13.5px",
                                    lineHeight: "1.55",
                                    boxShadow: msg.role === "user"
                                        ? "0 4px 14px rgba(37,99,235,0.3)"
                                        : "0 2px 8px rgba(0,0,0,0.06)",
                                    border: msg.role === "assistant" ? "1px solid #e2e8f0" : "none",
                                    whiteSpace: "pre-wrap",
                                    wordBreak: "break-word",
                                }}>
                                    {msg.text}
                                </div>
                            </div>
                        ))}

                        {/* Typing indicator */}
                        {loading && (
                            <div style={{ display: "flex", alignItems: "flex-end", gap: "8px", animation: "chatFadeIn 0.2s ease" }}>
                                <div style={{
                                    width: "28px", height: "28px", borderRadius: "50%",
                                    background: "linear-gradient(135deg, #2563eb, #7c3aed)",
                                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                                }}>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="white">
                                        <path d="M20 2H4a2 2 0 00-2 2v18l4-4h14a2 2 0 002-2V4a2 2 0 00-2-2z" />
                                    </svg>
                                </div>
                                <div style={{
                                    padding: "12px 16px", background: "white",
                                    borderRadius: "18px 18px 18px 4px",
                                    border: "1px solid #e2e8f0",
                                    boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                                    display: "flex", gap: "4px", alignItems: "center",
                                }}>
                                    <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#94a3b8", animation: "typingDot 1.2s infinite 0s" }} />
                                    <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#94a3b8", animation: "typingDot 1.2s infinite 0.2s" }} />
                                    <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#94a3b8", animation: "typingDot 1.2s infinite 0.4s" }} />
                                </div>
                            </div>
                        )}

                        {/* Suggestions */}
                        {showSuggestions && !loading && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "4px" }}>
                                {SUGGESTIONS.map((s) => (
                                    <button
                                        key={s}
                                        onClick={() => sendMessage(s)}
                                        style={{
                                            padding: "6px 12px",
                                            borderRadius: "999px",
                                            border: "1px solid #c7d2fe",
                                            background: "#eef2ff",
                                            color: "#4338ca",
                                            fontSize: "12px",
                                            fontWeight: 500,
                                            cursor: "pointer",
                                            transition: "all 0.15s",
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.background = "#c7d2fe"
                                            e.currentTarget.style.borderColor = "#818cf8"
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.background = "#eef2ff"
                                            e.currentTarget.style.borderColor = "#c7d2fe"
                                        }}
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        )}

                        <div ref={bottomRef} />
                    </div>

                    {/* Input */}
                    <div style={{
                        padding: "12px 14px",
                        borderTop: "1px solid #e2e8f0",
                        display: "flex",
                        gap: "10px",
                        alignItems: "flex-end",
                        background: "white",
                        flexShrink: 0,
                    }}>
                        <textarea
                            ref={inputRef}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Ask about your document..."
                            rows={1}
                            disabled={loading}
                            style={{
                                flex: 1,
                                padding: "10px 14px",
                                borderRadius: "12px",
                                border: "1.5px solid #e2e8f0",
                                fontSize: "13.5px",
                                resize: "none",
                                outline: "none",
                                color: "#1e293b",
                                background: "#f8fafc",
                                lineHeight: "1.5",
                                fontFamily: "inherit",
                                transition: "border-color 0.15s",
                                maxHeight: "100px",
                                overflowY: "auto",
                            }}
                            onFocus={(e) => e.target.style.borderColor = "#6366f1"}
                            onBlur={(e) => e.target.style.borderColor = "#e2e8f0"}
                        />
                        <button
                            onClick={() => sendMessage()}
                            disabled={!input.trim() || loading}
                            style={{
                                width: "40px",
                                height: "40px",
                                borderRadius: "12px",
                                background: !input.trim() || loading
                                    ? "#e2e8f0"
                                    : "linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)",
                                border: "none",
                                cursor: !input.trim() || loading ? "not-allowed" : "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                                transition: "all 0.15s",
                                boxShadow: !input.trim() || loading ? "none" : "0 4px 12px rgba(37,99,235,0.35)",
                            }}
                        >
                            <svg width="17" height="17" fill="none" stroke={!input.trim() || loading ? "#94a3b8" : "white"} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14M12 5l7 7-7 7" />
                            </svg>
                        </button>
                    </div>
                </div>
            )}

            <style>{`
                @keyframes chatSlideUp {
                    from { opacity: 0; transform: translateY(24px) scale(0.96); }
                    to   { opacity: 1; transform: translateY(0) scale(1); }
                }
                @keyframes chatFadeIn {
                    from { opacity: 0; transform: translateY(6px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
                @keyframes chatPulse {
                    0%, 100% { transform: scale(1); opacity: 0.6; }
                    50%       { transform: scale(1.6); opacity: 0; }
                }
                @keyframes typingDot {
                    0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
                    30%           { transform: translateY(-5px); opacity: 1; }
                }
            `}</style>
        </>
    )
}
