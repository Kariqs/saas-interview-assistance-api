import { Request, Response } from "express";
import fs from "fs/promises";
import mammoth from "mammoth";
import { upload } from "../middlewares/upload";
import Interview from "../models/interview";
import { AuthenticatedRequest } from "../middlewares/auth";
import mongoose from "mongoose";
import { count } from "console";
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
    const { question, resumeText, jobDescription } = req.body;

    console.log(jobDescription)

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
Be confident, concise (80-100 words), direct.
No fluff, no hedging.
Use STAR only for behavioral questions.
Quantify achievements when possible.
Sound natural.

**Strictly use only the information from the resume and job description provided.**

Use this resume for context:
${resumeText || "No resume provided."}

Also use this job description for  another context:
${jobDescription || "No job description provided provided."}

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

export const createInterview = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userEmail = req.user?.email;
    if (!userEmail) {
      return res.status(401).json({ message: "Unauthorized." });
    }

    const { date, timeTaken } = req.body;
    if (!date || timeTaken === undefined || timeTaken === null) {
      return res.status(400).json({ message: "Missing required fields." });
    }
    const newInterview = new Interview({ userEmail, date, timeTaken });
    const savedInterview = await newInterview.save();
    return res.status(201).json({
      message: "Interview created sucessfully.",
      interviewId: savedInterview._id,
    });
  } catch (error) {
    console.error("Interview creation error", error);
    return res.status(500).json({ message: "Error creating interview." });
  }
};

export const fetchInterviewsByEmail = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userEmail = req.user?.email;
    if (!userEmail) {
      return res.status(400).json({ message: "Unauthorized." });
    }
    const interviews = await Interview.find({ userEmail })
      .sort({
        createdAt: -1,
      })
      .limit(5)
      .select("-userEmail");

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    );
    const userInterviewsCount = await Interview.countDocuments({
      userEmail,
      date: { $gte: startOfMonth, $lte: endOfMonth },
    });

    return res.status(200).json({
      message: "Interviews fetched successfully.",
      interviews: interviews,
      count: userInterviewsCount,
    });
  } catch (error) {
    console.error("Error fetching interviews", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

export const deleteInterviewById = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const interviewId = req.params.id;
    const userEmail = req.user?.email;

    if (!userEmail) {
      return res.status(401).json({ message: "Unauthorized." });
    }

    if (!interviewId || !mongoose.Types.ObjectId.isValid(interviewId)) {
      return res.status(400).json({ message: "Invalid interview ID." });
    }

    const deletedInterview = await Interview.findOneAndDelete({
      _id: interviewId,
      userEmail,
    });

    if (!deletedInterview) {
      return res
        .status(404)
        .json({ message: "Interview not found or not yours." });
    }

    return res.status(200).json({ message: "Interview deleted successfully." });
  } catch (error) {
    console.error("Delete interview error:", error);
    return res.status(500).json({ message: "Error deleting interview." });
  }
};
