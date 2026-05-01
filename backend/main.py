import json
import os
import tempfile

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from deep_translator import GoogleTranslator

from backend.emotion import detect_emotion
from backend.speech import speech_to_text

app = FastAPI()

# Add CORS middleware to allow connections from any origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/frontend", StaticFiles(directory="frontend"), name="frontend")


@app.get("/")
async def read_index():
    return FileResponse("frontend/index.html")


def convert_to_english(text, language):
    if not text:
        return ""

    if language == "en":
        return text

    try:
        return GoogleTranslator(source="auto", target="en").translate(text)
    except Exception:
        return "English conversion unavailable."


@app.websocket("/audio-stream")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    try:
        while True:
            audio_bytes = await websocket.receive_bytes()

            with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
                tmp.write(audio_bytes)
                tmp_path = tmp.name

            try:
                speech = speech_to_text(tmp_path)
                text = speech["text"]

                response = {
                    "text": text or "No speech detected.",
                    "english_text": convert_to_english(text, speech["language"]),
                    "language": speech["language"],
                    "language_name": speech["language_name"],
                    "emotion": detect_emotion(text) if text else "neutral",
                }
            except Exception as exc:
                response = {
                    "error": str(exc),
                    "text": "Could not analyze this recording.",
                    "english_text": "English conversion unavailable.",
                    "language": "unknown",
                    "language_name": "Unknown",
                    "emotion": "unknown",
                }
            finally:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)

            await websocket.send_text(json.dumps(response, ensure_ascii=False))
    except WebSocketDisconnect:
        return
