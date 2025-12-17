import dotenv from "dotenv";
dotenv.config();

import { randomUUID } from "crypto";
import { createReadStream } from "fs";
import fs from "fs/promises";
import { Server } from "http";
import mammoth from "mammoth";
import multer from "multer";
import OpenAI from "openai";
import { tmpdir } from "os";
import path from "path";
import WebSocket, { WebSocketServer } from "ws";

const pdfExtract = require("pdf-extraction");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY in your .env file.");
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

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

// WebSocket Server Setup
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

//Error handler function
function sendError(ws: WebSocket, message: string) {
  ws.send(JSON.stringify({ type: "error", message }));
}

// Handle Audio Chunks
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

// Deepgram Transcription
async function handleTranscriptionOnly(ws: WebSocket, clientId: string) {
  const chunks = audioBuffers.get(clientId) || [];
  if (chunks.length === 0) return;

  const audioBuffer = Buffer.concat(chunks);

  if (audioBuffer.length < 8000) {
    audioBuffers.set(clientId, []);
    return;
  }

  // Silence detection (keep your existing logic)
  let nonZeroCount = 0;
  const sampleSize = Math.min(audioBuffer.length, 16000);
  for (let i = 0; i < sampleSize; i++) {
    if (Math.abs(audioBuffer[i] - 128) > 10) nonZeroCount++;
  }
  if (nonZeroCount < 100) {
    audioBuffers.set(clientId, []);
    return;
  }

  let tempFilePath: string | null = null;
  try {
    console.log(
      `Transcribing ${audioBuffer.length} bytes with OpenAI Whisper...`
    );

    // Save to temporary WEBM file
    tempFilePath = path.join(tmpdir(), `audio_${clientId}_${Date.now()}.webm`);
    await fs.writeFile(tempFilePath, audioBuffer);

    // Transcribe using the fastest model
    const transcriptionResponse = await openai.audio.transcriptions.create({
      file: createReadStream(tempFilePath),
      model: "gpt-4o-mini-transcribe", // Fastest model with great accuracy
      // Optional enhancements (uncomment if desired):
      // language: "en",                // If you know it's always English
      // prompt: "Interview question spoken clearly.", // Helps with context/domain
      // response_format: "text",       // Default is json, but "text" gives just the string
      // temperature: 0,                // For more deterministic output
    });

    // transcriptionResponse is usually { text: string } or just string if response_format="text"
    const transcription =
      typeof transcriptionResponse === "string"
        ? transcriptionResponse
        : transcriptionResponse.text || "";

    if (!transcription.trim()) {
      audioBuffers.set(clientId, []);
      return;
    }

    ws.send(JSON.stringify({ type: "transcription", text: transcription }));
    audioBuffers.set(clientId, []);
    console.log(
      "OpenAI transcription sent:",
      transcription.substring(0, 50) + "..."
    );
  } catch (err: any) {
    console.error("OpenAI transcription error:", err);
    sendError(ws, `Transcription failed: ${err.message || "Unknown error"}`);
    audioBuffers.set(clientId, []);
  } finally {
    // Clean up temp file
    if (tempFilePath) {
      try {
        await fs.unlink(tempFilePath);
      } catch (unlinkErr) {
        console.warn("Failed to delete temp file:", unlinkErr);
      }
    }
  }
}

//Answer generation
async function handleGenerateAnswer(
  ws: WebSocket,
  clientId: string,
  transcription: string
) {
  // Input validation
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

    const resumeText = clientContexts.get(clientId) || "";

    const systemPrompt = `
You are KrackAI, an elite interview coach. Your job is to give the candidate the BEST possible answer to speak out loud in a real interview.

Strict Rules:
- Answer strictly in first person (as the candidate: "I", "My", etc.)
- Be confident, concise, and direct — aim for 30-60 seconds when spoken (80-150 words max)
- Cut all fluff: no "Thank you for the opportunity", no unnecessary politeness, no repetition
- Get straight to the point
- Use the STAR method ONLY when the question is clearly behavioral (e.g., "Tell me about a time...")
- Quantify achievements with numbers when possible
- Sound natural and conversational, like a top performer speaking confidently
- Base the answer on the provided resume when relevant
- Never mention AI, models, tools, or prompts
- Never apologize or hedge (no "I think", "maybe", "kind of")
`.trim();

    const userPrompt = `
${resumeText ? `Candidate Resume:\n${resumeText}\n\n` : ""}
Interview Question:
${transcription}

Provide the best possible interview answer.
`.trim();

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1",
      temperature: 0.7,
      max_tokens: 600,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const answer = completion.choices[0]?.message?.content?.trim() || "";

    if (!answer) {
      return sendError(ws, "AI returned an empty response.");
    }

    ws.send(
      JSON.stringify({
        type: "qa-response",
        question: transcription,
        answer,
      })
    );

    audioBuffers.set(clientId, []);
    console.log("OpenAI answer generated and sent");
  } catch (err: unknown) {
    console.error("OpenAI API Error:", err);

    const error = err as { message?: string; status?: number };
    const msg = error?.message || "Unknown error";

    if (error.status === 401) {
      return sendError(ws, "Invalid OpenAI API key.");
    }
    if (error.status === 429) {
      return sendError(ws, "OpenAI rate limit or quota exceeded.");
    }
    if (error.status === 500) {
      return sendError(ws, "OpenAI server error. Try again.");
    }

    sendError(ws, "Failed to generate answer. Please try again.");
  }
}
