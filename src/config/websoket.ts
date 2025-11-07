import WebSocket, { WebSocketServer } from "ws";
import { Server } from "http";
import axios from "axios";
import fs from "fs/promises";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import path from "path";
import multer from "multer";
const pdfParse = require("pdf-parse").default;
const pdfExtract = require("pdf-extraction");
import mammoth from "mammoth";

interface AudioChunkMessage {
  type: "audio-chunk";
  audio: string;
}
interface TranscribeMessage {
  type: "transcribe";
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
  | TranscribeMessage
  | ClearMessage
  | SetContextMessage;

interface GeminiApiResponse {
  candidates?: {
    content?: {
      parts?: { text?: string }[];
    };
  }[];
}

const MAX_CHUNKS = 1000;
const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB
const API_TIMEOUT = 30000;

const audioBuffers = new Map<string, Buffer[]>();
const clientContexts = new Map<string, string>(); // Store resume context per client

// Setup multer for file uploads
const upload = multer({
  dest: tmpdir(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

export function setupApiRoutes(app: any) {
  // Upload resume endpoint
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

        // Extract text based on file type
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

        // Clean up uploaded file
        await fs.unlink(filePath);

        if (!text.trim()) {
          return res
            .status(400)
            .json({ error: "Could not extract text from file" });
        }

        console.log("📄 Resume uploaded, extracted", text.length, "characters");
        res.json({ text, success: true });
      } catch (error: any) {
        console.error("Resume upload error:", error);
        res.status(500).json({ error: error.message });
      }
    }
  );

  // Ask question endpoint (with resume context)
  app.post("/api/ask", async (req: any, res: any) => {
    try {
      const { question, resumeText } = req.body;

      if (!question) {
        return res.status(400).json({ error: "Question is required" });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "API key not configured" });
      }

      // Build prompt with resume context
      let prompt = `Your name is KrackAI. You are helping someone in a job interview.\n\n`;

      if (resumeText) {
        prompt += `Here is the candidate's resume:\n${resumeText}\n\n`;
        prompt += `Based on their resume and experience, answer this interview question concisely and professionally:\n${question}`;
      } else {
        prompt += `Answer this interview question concisely:\n${question}`;
      }

      const answer = await callGemini(apiKey, [{ text: prompt }]);

      res.json({ question, answer: answer.trim() });
    } catch (error: any) {
      console.error("API error:", error);
      res.status(500).json({ error: error.message });
    }
  });
}

export function initializeWebSocket(server: Server) {
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws: WebSocket) => {
    console.log("🔌 Client connected");
    const clientId = randomUUID();
    audioBuffers.set(clientId, []);

    ws.on("message", async (message: WebSocket.RawData) => {
      try {
        const data = JSON.parse(message.toString()) as ClientMessage;

        if (data.type === "audio-chunk") {
          handleAudioChunk(ws, clientId, data.audio);
        } else if (data.type === "transcribe") {
          await handleTranscription(ws, clientId);
        } else if (data.type === "clear") {
          audioBuffers.set(clientId, []);
          ws.send(JSON.stringify({ type: "cleared" }));
        } else if (data.type === "set-context") {
          clientContexts.set(clientId, data.resumeText);
          ws.send(JSON.stringify({ type: "context-set" }));
          console.log("📄 Resume context set for client", clientId);
        }
      } catch (error: any) {
        sendError(ws, `Server error: ${error.message}`);
      }
    });

    ws.on("close", () => {
      console.log("❎ Client disconnected");
      audioBuffers.delete(clientId);
      clientContexts.delete(clientId);
    });
  });

  console.log("✅ WebSocket server ready");
}

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

async function handleTranscription(ws: WebSocket, clientId: string) {
  const chunks = audioBuffers.get(clientId) || [];

  if (chunks.length === 0) {
    return sendError(ws, "No audio data received");
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return sendError(ws, "Gemini API key not configured");
  }

  const tempPath = path.join(tmpdir(), `audio-${randomUUID()}.webm`);

  try {
    const audioBuffer = Buffer.concat(chunks);
    await fs.writeFile(tempPath, audioBuffer);

    ws.send(JSON.stringify({ type: "info", message: "Transcribing audio..." }));

    const base64Audio = audioBuffer.toString("base64");
    const transcription = await callGemini(apiKey, [
      {
        text: "Transcribe this audio file. Provide only the text without extra commentary.",
      },
      { inline_data: { mime_type: "audio/webm", data: base64Audio } },
    ]);

    ws.send(JSON.stringify({ type: "transcription", text: transcription }));

    // Check if it's a question
    if (isQuestion(transcription)) {
      ws.send(
        JSON.stringify({
          type: "info",
          message: "Detected a question. Fetching answer...",
        })
      );

      // Get resume context for this client
      const resumeText = clientContexts.get(clientId) || "";

      // Build prompt with resume context
      let prompt = `Your name is KrackAI. You are helping someone in a job interview.\n\n`;

      if (resumeText) {
        prompt += `Here is the candidate's resume:\n${resumeText}\n\n`;
        prompt += `Based on their resume and experience, answer this interview question concisely and professionally:\n${transcription}`;
      } else {
        prompt += `Answer this interview question concisely:\n${transcription}`;
      }

      const answer = await callGemini(apiKey, [{ text: prompt }]);

      ws.send(
        JSON.stringify({
          type: "qa-response",
          question: transcription,
          answer: answer.trim(),
        })
      );
    }
  } catch (err: any) {
    sendError(ws, `Processing failed: ${err.message}`);
  } finally {
    await fs.unlink(tempPath).catch(() => {});
    audioBuffers.set(clientId, []);
  }
}

async function callGemini(apiKey: string, parts: any[]): Promise<string> {
  const response = await axios.post<GeminiApiResponse>(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    { contents: [{ parts }] },
    { headers: { "Content-Type": "application/json" }, timeout: API_TIMEOUT }
  );

  return (
    response.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
    "No response available."
  );
}

function isQuestion(text: string): boolean {
  return (
    text.endsWith("?") ||
    /^(who|what|when|where|why|how|is|are|can|could|should|would|do|does|tell|describe|explain)\b/i.test(
      text
    )
  );
}

function sendError(ws: WebSocket, message: string) {
  ws.send(JSON.stringify({ type: "error", message }));
}
