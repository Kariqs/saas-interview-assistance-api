import dotenv from "dotenv";
dotenv.config();

import WebSocket, { WebSocketServer } from "ws";
import { Server } from "http";
import fs from "fs/promises";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import multer from "multer";
import { GoogleGenerativeAI } from "@google/generative-ai";

const pdfExtract = require("pdf-extraction");
import mammoth from "mammoth";

// ============================
// Gemini Setup (same as chatController)
// ============================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("Missing GEMINI_API_KEY in your .env file.");
  process.exit(1);
}
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

import axios from "axios";

interface AudioChunkMessage {
  type: "audio-chunk";
  audio: string;
}
interface TranscribeOnlyMessage {
  type: "transcribe-only";
}
interface GenerateAnswerMessage {
  type: "generate-answer";
  transcription: string;
}
interface ClearMessage {
  type: "clear";
}
interface SetContextMessage {
  type: "set-context";
  resumeText: string;
}
type ClientMessage =
  | AudioChunkMessage
  | TranscribeOnlyMessage
  | GenerateAnswerMessage
  | ClearMessage
  | SetContextMessage;

interface DeepgramResponse {
  results?: {
    channels?: {
      alternatives?: {
        transcript?: string;
      }[];
    }[];
  };
}

const MAX_CHUNKS = 1000;
const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10 MB
const API_TIMEOUT = 60000;

const audioBuffers = new Map<string, Buffer[]>();
const clientContexts = new Map<string, string>(); // resume text per client

const upload = multer({
  dest: tmpdir(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max resume
});

// ============================
// Resume Upload Route
// ============================
export function setupApiRoutes(app: any) {
  app.post(
    "/api/upload-resume",
    upload.single("resume"),
    async (req: any, res: any) => {
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

        console.log("Resume uploaded, extracted", text.length, "characters");
        res.json({ text, success: true });
      } catch (error: any) {
        console.error("Resume upload error:", error);
        res.status(500).json({ error: error.message || "Upload failed" });
      }
    }
  );
}

// ============================
// WebSocket Server Setup
// ============================
export function initializeWebSocket(server: Server) {
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws: WebSocket) => {
    console.log("Client connected");
    const clientId = randomUUID();
    audioBuffers.set(clientId, []);
    clientContexts.set(clientId, ""); // optional resume context

    ws.on("message", async (message: WebSocket.RawData) => {
      try {
        const data = JSON.parse(message.toString()) as ClientMessage;

        if (data.type === "audio-chunk") {
          handleAudioChunk(ws, clientId, data.audio);
        } else if (data.type === "transcribe-only") {
          await handleTranscriptionOnly(ws, clientId);
        } else if (data.type === "generate-answer") {
          await handleGenerateAnswer(ws, clientId, data.transcription);
        } else if (data.type === "clear") {
          audioBuffers.set(clientId, []);
          ws.send(JSON.stringify({ type: "cleared" }));
        } else if (data.type === "set-context") {
          clientContexts.set(clientId, data.resumeText);
          ws.send(JSON.stringify({ type: "context-set" }));
          console.log("Resume context set for client", clientId);
        }
      } catch (error: any) {
        sendError(ws, `Server error: ${error.message}`);
      }
    });

    ws.on("close", () => {
      console.log("Client disconnected");
      audioBuffers.delete(clientId);
      clientContexts.delete(clientId);
    });
  });

  console.log("WebSocket server ready on /ws");
}

// ============================
// Helper: Send Error
// ============================
function sendError(ws: WebSocket, message: string) {
  ws.send(JSON.stringify({ type: "error", message }));
}

// ============================
// Handle Audio Chunks
// ============================
function handleAudioChunk(ws: WebSocket, clientId: string, audio: string) {
  const chunks = audioBuffers.get(clientId) || [];

  if (chunks.length >= MAX_CHUNKS) {
    return sendError(ws, "Too many audio chunks");
  }

  const buffer = Buffer.from(audio, "base64");
  const totalSize =
    chunks.reduce((sum, b) => sum + b.length, 0) + buffer.length;

  if (totalSize > MAX_BUFFER_SIZE) {
    return sendError(ws, "Audio data too large");
  }

  chunks.push(buffer);
  audioBuffers.set(clientId, chunks);
  ws.send(JSON.stringify({ type: "chunk-received" }));
}

// ============================
// Deepgram Transcription (unchanged)
// ============================
async function handleTranscriptionOnly(ws: WebSocket, clientId: string) {
  const chunks = audioBuffers.get(clientId) || [];
  if (chunks.length === 0) return;

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) return sendError(ws, "Deepgram API key not configured");

  const audioBuffer = Buffer.concat(chunks);

  if (audioBuffer.length < 8000) {
    audioBuffers.set(clientId, []);
    return;
  }

  // Silence detection
  let nonZeroCount = 0;
  const sampleSize = Math.min(audioBuffer.length, 16000);
  for (let i = 0; i < sampleSize; i++) {
    if (Math.abs(audioBuffer[i] - 128) > 10) nonZeroCount++;
  }
  if (nonZeroCount < 100) {
    audioBuffers.set(clientId, []);
    return;
  }

  try {
    console.log(`Transcribing ${audioBuffer.length} bytes...`);
    const response = await axios.post<DeepgramResponse>(
      "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true",
      audioBuffer,
      {
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": "audio/webm",
        },
        timeout: API_TIMEOUT,
      }
    );

    const transcription =
      response.data.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";

    if (!transcription.trim()) {
      audioBuffers.set(clientId, []);
      return;
    }

    ws.send(JSON.stringify({ type: "transcription", text: transcription }));
    audioBuffers.set(clientId, []);
    console.log("Transcription sent:", transcription.substring(0, 50) + "...");
  } catch (err: any) {
    console.error("Deepgram error:", err.message);
    sendError(ws, `Transcription failed: ${err.message}`);
    audioBuffers.set(clientId, []);
  }
}

// ============================
// Generate Answer — NOW MATCHES chatController STYLE
// ============================
async function handleGenerateAnswer(
  ws: WebSocket,
  clientId: string,
  transcription: string
) {
  // Input validation (same as chatController)
  if (
    !transcription ||
    typeof transcription !== "string" ||
    !transcription.trim()
  ) {
    return sendError(
      ws,
      "Transcription is required and must be a non-empty string."
    );
  }
  if (transcription.length > 2000) {
    return sendError(ws, "Question is too long. Maximum 2000 characters.");
  }

  try {
    ws.send(
      JSON.stringify({ type: "info", message: "Generating AI answer..." })
    );

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash", // or "gemini-1.5-pro" for better quality
    });

    const resumeText = clientContexts.get(clientId) || "";

    const prompt = `
Your name is KrackAI.
You are a world-class interview coach helping a candidate crush their job interview.

${
  resumeText
    ? `Here is the candidate's full resume for context:\n${resumeText}\n\nUse it to give specific, impressive, and personalized answers.\n`
    : ""
}
Rules:
- Answer in first person (as the candidate)
- Be confident, concise, and professional
- Use STAR method when appropriate
- Include metrics and achievements from the resume when possible
- Sound natural and conversational

Interview question: ${transcription}

Your answer:
    `.trim();

    const result = await model.generateContent(prompt);
    const answer = result.response.text();

    ws.send(
      JSON.stringify({
        type: "qa-response",
        question: transcription,
        answer: answer.trim(),
      })
    );

    audioBuffers.set(clientId, []);
    console.log("Answer generated and sent");
  } catch (err: unknown) {
    console.error("Gemini API Error in generate-answer:", err);

    const error = err as { message?: string; status?: number };
    const msg = error?.message || "Unknown error";

    if (msg.includes("API key") || error.status === 401) {
      return sendError(ws, "Invalid Gemini API key. Check your .env file.");
    }
    if (msg.includes("quota") || error.status === 429) {
      return sendError(ws, "Gemini API quota exceeded. Try again later.");
    }
    if (error.status === 404) {
      return sendError(ws, "Gemini model not available.");
    }

    sendError(ws, "Failed to generate answer. Please try again.");
  }
}
