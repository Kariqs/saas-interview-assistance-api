import WebSocket, { WebSocketServer } from "ws";
import { Server } from "http";
import axios from "axios";
import fs from "fs";
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
      parts?: {
        text?: string;
      }[];
    };
  }[];
}

const audioBuffers: Map<string, Buffer[]> = new Map();

export function initializeWebSocket(server: Server) {
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws: WebSocket) => {
    console.log("🔌 Client connected");
    const clientId = `${Date.now()}-${Math.random()}`;
    audioBuffers.set(clientId, []);

    ws.on("message", async (message: WebSocket.RawData) => {
      try {
        const data = JSON.parse(message.toString()) as ClientMessage;

        // 1️⃣ Handle Audio Chunks
        if (data.type === "audio-chunk") {
          const buffer = Buffer.from(data.audio, "base64");
          const chunks = audioBuffers.get(clientId) || [];
          chunks.push(buffer);
          audioBuffers.set(clientId, chunks);

          ws.send(JSON.stringify({ type: "chunk-received" }));
          return;
        }

        // 2️⃣ Handle Transcription Request
        if (data.type === "transcribe") {
          const chunks = audioBuffers.get(clientId) || [];
          if (chunks.length === 0) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "No audio data received",
              })
            );
            return;
          }

          const audioBuffer = Buffer.concat(chunks);
          const tempPath = path.join(__dirname, `temp-${clientId}.webm`);
          fs.writeFileSync(tempPath, audioBuffer);

          const apiKey = process.env.GEMINI_API_KEY;
          if (!apiKey) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Gemini API key not configured.",
              })
            );
            fs.unlinkSync(tempPath);
            return;
          }

          try {
            // 🎙️ STEP 1 — Transcription
            ws.send(
              JSON.stringify({
                type: "info",
                message: "Transcribing audio...",
              })
            );

            const audioData = fs.readFileSync(tempPath);
            const base64Audio = audioData.toString("base64");

            const response = await axios.post<GeminiApiResponse>(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
              {
                contents: [
                  {
                    parts: [
                      {
                        text: "Transcribe this audio file. Provide only the text without extra commentary.",
                      },
                      {
                        inline_data: {
                          mime_type: "audio/webm",
                          data: base64Audio,
                        },
                      },
                    ],
                  },
                ],
              },
              { headers: { "Content-Type": "application/json" } }
            );

            const transcription =
              response.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
              "";

            ws.send(
              JSON.stringify({
                type: "transcription",
                text: transcription,
              })
            );

            // 🧠 STEP 2 — Check if it's a question
            const isQuestion =
              transcription.endsWith("?") ||
              /^(who|what|when|where|why|how|is|are|can|should)\b/i.test(
                transcription
              );

            if (isQuestion) {
              ws.send(
                JSON.stringify({
                  type: "info",
                  message: "Detected a question. Fetching answer...",
                })
              );

              // 💬 STEP 3 — Ask Gemini for an answer
              const qaResponse = await axios.post<GeminiApiResponse>(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
                {
                  contents: [
                    {
                      parts: [
                        {
                          text: `
                          Your name is KrackAI.
                          Answer this question concisely and accurately:\n${transcription}`,
                        },
                      ],
                    },
                  ],
                },
                { headers: { "Content-Type": "application/json" } }
              );

              const answer =
                qaResponse.data.candidates?.[0]?.content?.parts?.[0]?.text ||
                "No answer available.";

              ws.send(
                JSON.stringify({
                  type: "qa-response",
                  question: transcription,
                  answer: answer.trim(),
                })
              );
            } else {
              ws.send(
                JSON.stringify({
                  type: "info",
                  message: "No question detected in the transcription.",
                })
              );
            }
          } catch (err: any) {
            console.error("❌ Error:", err.message);
            ws.send(
              JSON.stringify({
                type: "error",
                message: `Processing failed: ${err.message}`,
              })
            );
          } finally {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            audioBuffers.set(clientId, []);
          }

          return;
        }

        // 3️⃣ Clear buffer if requested
        if (data.type === "clear") {
          audioBuffers.set(clientId, []);
          ws.send(JSON.stringify({ type: "cleared" }));
        }
      } catch (error: any) {
        console.error("⚠️ Message handling error:", error);
        ws.send(
          JSON.stringify({
            type: "error",
            message: `Server error: ${error.message}`,
          })
        );
      }
    });

    ws.on("close", () => {
      console.log("❎ Client disconnected");
      audioBuffers.delete(clientId);
    });
  });

  console.log("✅ WebSocket server ready for audio + Q&A");
}
