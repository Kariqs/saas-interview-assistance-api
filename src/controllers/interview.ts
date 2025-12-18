import { Request, Response } from "express";
import fs from "fs/promises";
import mammoth from "mammoth";
import { upload } from "../middlewares/upload";
const pdfExtract = require("pdf-extraction");

export const uploadResume = [
  upload.single("resume"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const filePath = req.file.path;
      let text = "";

      if (req.file.mimetype === "application/pdf") {
        const dataBuffer = await fs.readFile(filePath);
        const pdfData = await pdfExtract(dataBuffer);
        text = pdfData.text;
      } else if (
        req.file.mimetype ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ) {
        const result = await mammoth.extractRawText({ path: filePath });
        text = result.value;
      } else if (req.file.mimetype === "text/plain") {
        text = await fs.readFile(filePath, "utf-8");
      } else {
        await fs.unlink(filePath);
        return res.status(400).json({ error: "Unsupported file type" });
      }

      await fs.unlink(filePath);

      if (!text.trim()) {
        return res
          .status(400)
          .json({ error: "Could not extract text from file" });
      }

      res.json({ text });
    } catch (error: any) {
      console.error("Resume upload error:", error);
      res.status(500).json({ error: error.message || "Upload failed" });
    }
  },
];

export const generateAnswer = async (req: Request, res: Response) => {
  try {
    const { question, resumeText } = req.body;

    if (!question?.trim()) {
      return res.status(400).json({ error: "No question provided" });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.7,
        max_tokens: 300,
        messages: [
          {
            role: "system",
            content: `
You are KrackAI, an elite interview coach.

Respond in first person as the candidate.
Be confident, concise (80-150 words), direct.
No fluff, no hedging.
Use STAR only for behavioral questions.
Quantify achievements when possible.
Sound natural.

Use this resume for context:
${resumeText || "No resume provided."}

Never mention being an AI.
            `.trim(),
          },
          { role: "user", content: question },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || "OpenAI request failed");
    }

    const data = await response.json();
    const answer = data.choices[0]?.message?.content?.trim() || "";

    res.json({ question: question.trim(), answer });
  } catch (error: any) {
    console.error("Answer generation error:", error);
    res
      .status(500)
      .json({ error: error.message || "Failed to generate answer" });
  }
};
