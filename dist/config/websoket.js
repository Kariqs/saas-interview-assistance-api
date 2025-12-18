"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeRealtimeWebSocket = initializeRealtimeWebSocket;
const ws_1 = require("ws");
const ws_2 = __importDefault(require("ws"));
function initializeRealtimeWebSocket(server) {
    const wss = new ws_1.WebSocketServer({ server });
    wss.on("connection", (ws) => {
        console.log("Client connected for transcription");
        let isRealtimeReady = false;
        const realtimeWS = new ws_2.default("wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01", {
            headers: {
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                "OpenAI-Beta": "realtime=v1",
            },
        });
        realtimeWS.on("open", () => {
            console.log("Connected to OpenAI Realtime API");
            isRealtimeReady = true;
            realtimeWS.send(JSON.stringify({
                type: "session.update",
                session: {
                    turn_detection: { type: "server_vad", silence_duration_ms: 800 },
                    input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
                    input_audio_format: "pcm16",
                    modalities: ["text"],
                },
            }));
        });
        realtimeWS.on("message", (data) => {
            try {
                const event = JSON.parse(data.toString());
                if (event.type === "conversation.item.input_audio_transcription.delta") {
                    ws.send(JSON.stringify({
                        type: "transcription-delta",
                        text: event.delta || "",
                    }));
                }
                if (event.type === "conversation.item.input_audio_transcription.completed") {
                    ws.send(JSON.stringify({
                        type: "transcription",
                        text: event.transcript || "",
                    }));
                }
                if (event.type === "error") {
                    console.error("OpenAI Realtime error:", event.error);
                    ws.send(JSON.stringify({
                        type: "error",
                        message: event.error?.message || "Transcription error",
                    }));
                }
            }
            catch (err) {
                console.error("Failed to parse OpenAI event:", err);
            }
        });
        realtimeWS.on("close", () => ws.close());
        realtimeWS.on("error", (err) => console.error("OpenAI Realtime connection error:", err));
        ws.on("message", (message) => {
            if (!isRealtimeReady)
                return;
            try {
                const data = JSON.parse(message.toString());
                if (data.type === "audio-chunk") {
                    const buffer = Buffer.from(data.audio, "base64");
                    realtimeWS.send(JSON.stringify({
                        type: "input_audio_buffer.append",
                        audio: buffer.toString("base64"),
                    }));
                }
            }
            catch (err) {
                console.error("Failed to parse client message:", err);
            }
        });
        ws.on("close", () => {
            realtimeWS.close();
            console.log("Client disconnected");
        });
    });
    console.log("Realtime transcription WebSocket server initialized");
}
