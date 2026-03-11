import mongoose from "mongoose"

export default mongoose.model(
  "File",
  new mongoose.Schema({
    userId: { type: String, default: "anonymous" },
    originalName: { type: String, default: "" },
    originalPdf: String,
    summaryPdf: String,
    createdAt: { type: Date, default: Date.now }
  })
)
