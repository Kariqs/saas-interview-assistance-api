import WebSocket, { WebSocketServer } from "ws";
import { Server } from "http";
import axios from "axios";
import fs from "fs/promises";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import path from "path";

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
type ClientMessage = AudioChunkMessage | TranscribeMessage | ClearMessage;

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
        }
      } catch (error: any) {
        sendError(ws, `Server error: ${error.message}`);
      }
    });

    ws.on("close", () => {
      console.log("❎ Client disconnected");
      audioBuffers.delete(clientId);
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

      const answer = await callGemini(apiKey, [
        {
          text: `Your name is KrackAI. Answer this question concisely:\n${transcription}`,
        },
      ]);

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
    /^(who|what|when|where|why|how|is|are|can|could|should|would|do|does)\b/i.test(
      text
    )
  );
}

function sendError(ws: WebSocket, message: string) {
  ws.send(JSON.stringify({ type: "error", message }));
}
