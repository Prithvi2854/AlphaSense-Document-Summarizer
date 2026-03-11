import express from "express"
import mongoose from "mongoose"
import cors from "cors"
import dotenv from "dotenv"
import pdfRoutes from "./routes/pdf.js"

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json())

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.error("MongoDB error:", err))

app.use("/api/pdf", pdfRoutes)

app.listen(5000, () => console.log("Server running on port 5000"))
