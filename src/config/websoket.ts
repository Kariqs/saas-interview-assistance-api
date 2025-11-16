import WebSocket, { WebSocketServer } from "ws";
import { Server } from "http";
import axios from "axios";
import fs from "fs/promises";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import multer from "multer";
const pdfExtract = require("pdf-extraction");
import mammoth from "mammoth";

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

interface GeminiApiResponse {
  candidates?: {
    content?: {
      parts?: { text?: string }[];
    };
  }[];
}

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
const MAX_BUFFER_SIZE = 10 * 1024 * 1024;
const API_TIMEOUT = 60000;

const audioBuffers = new Map<string, Buffer[]>();
const clientContexts = new Map<string, string>();

const upload = multer({
  dest: tmpdir(),
  limits: { fileSize: 5 * 1024 * 1024 },
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
        res.status(500).json({ error: error.message });
      }
    }
  );
}

export function initializeWebSocket(server: Server) {
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws: WebSocket) => {
    console.log("Client connected");
    const clientId = randomUUID();
    audioBuffers.set(clientId, []);

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

  console.log("WebSocket server ready");
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

async function handleTranscriptionOnly(ws: WebSocket, clientId: string) {
  const chunks = audioBuffers.get(clientId) || [];

  if (chunks.length === 0) {
    console.log("No audio chunks to transcribe");
    return;
  }

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return sendError(ws, "Deepgram API key not configured");
  }

  const audioBuffer = Buffer.concat(chunks);

  if (audioBuffer.length < 8000) {
    console.log(`Audio too small (${audioBuffer.length} bytes), skipping`);
    audioBuffers.set(clientId, []);
    return;
  }

  let nonZeroCount = 0;
  const sampleSize = Math.min(audioBuffer.length, 16000);
  for (let i = 0; i < sampleSize; i++) {
    if (Math.abs(audioBuffer[i] - 128) > 10) nonZeroCount++;
  }
  if (nonZeroCount < 100) {
    console.log("Silent audio detected, skipping");
    audioBuffers.set(clientId, []);
    return;
  }

  try {
    console.log(`Transcribing ${audioBuffer.length} bytes with Deepgram...`);
    const startTime = Date.now();

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
      console.log("Empty transcription received");
      audioBuffers.set(clientId, []);
      return;
    }

    const duration = Date.now() - startTime;
    console.log(`Deepgram transcription took ${duration}ms`);

    ws.send(JSON.stringify({ type: "transcription", text: transcription }));
    audioBuffers.set(clientId, []);
    console.log("Transcription sent:", transcription.substring(0, 50) + "...");
  } catch (err: any) {
    console.error("Deepgram transcription error:", err.message);
    sendError(ws, `Transcription failed: ${err.message}`);
    audioBuffers.set(clientId, []);
  }
}

async function handleGenerateAnswer(
  ws: WebSocket,
  clientId: string,
  transcription: string
) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return sendError(ws, "Gemini API key not configured");
  }

  try {
    ws.send(
      JSON.stringify({
        type: "info",
        message: "Generating AI answer...",
      })
    );

    const resumeText = clientContexts.get(clientId) || "";

    let prompt = `Your name is KrackAI. You are helping someone in a job interview.\n\n`;

    if (resumeText) {
      prompt += `Here is the candidate's resume:\n${resumeText}\n\n`;
      prompt += `Based on their resume and experience, answer this interview question concisely and professionally:\n${transcription}`;
    } else {
      prompt += `Answer this interview question concisely and professionally:\n${transcription}`;
    }

    const answer = await callGemini(apiKey, [{ text: prompt }]);

    ws.send(
      JSON.stringify({
        type: "qa-response",
        question: transcription,
        answer: answer.trim(),
      })
    );

    audioBuffers.set(clientId, []);
    console.log("Answer generated and audio buffer cleared");
  } catch (err: any) {
    sendError(ws, `Failed to generate answer: ${err.message}`);
  }
}

async function callGemini(apiKey: string, parts: any[]): Promise<string> {
  const maxRetries = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Calling Gemini API (attempt ${attempt}/${maxRetries})...`);

      const response = await axios.post<GeminiApiResponse>(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-exp:generateContent?key=${apiKey}`,
        { contents: [{ parts }] },
        {
          headers: { "Content-Type": "application/json" },
          timeout: API_TIMEOUT,
          validateStatus: (status) => status < 500,
        }
      );

      const text =
        response.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

      if (text) {
        console.log(`Gemini response received (${text.length} chars)`);
        return text;
      }

      throw new Error("No response text from Gemini");
    } catch (err: any) {
      lastError = err;
      console.error(`Gemini attempt ${attempt} failed:`, err.message);

      if (attempt < maxRetries) {
        const delay = attempt * 2000;
        console.log(`Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(
    `Gemini API failed after ${maxRetries} attempts: ${lastError?.message}`
  );
}

function sendError(ws: WebSocket, message: string) {
  ws.send(JSON.stringify({ type: "error", message }));
}
