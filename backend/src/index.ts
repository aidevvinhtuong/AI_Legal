import path from "path";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { pushEcontract } from "./routes/econtract";
import { reuploadReview, reuploadUpload } from "./routes/reviews";
import { getSystemPrompts, putSystemPrompt } from "./routes/system-prompts";

dotenv.config({ path: path.join(process.cwd(), ".env") });
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const app = express();
const port = Number(process.env.PORT || 8000);

app.use(cors({ origin: true }));
app.use(express.json({ limit: "40mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "ai-legal-backend" });
});

app.post("/api/econtract/push", pushEcontract);
app.post(
  "/api/reviews/:id/reupload",
  reuploadUpload.single("file"),
  reuploadReview
);
app.get("/api/system-prompts", getSystemPrompts);
app.put("/api/system-prompts", putSystemPrompt);

app.listen(port, () => {
  console.log(`[ai-legal-backend] http://localhost:${port}`);
});
