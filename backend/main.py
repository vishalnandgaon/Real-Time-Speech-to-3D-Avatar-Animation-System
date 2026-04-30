from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from deep_translator import GoogleTranslator
import json
import tempfile
import os
import threading

try:
    from .speech import speech_to_text, get_model
    from .emotion import detect_emotion, get_emotion_pipeline
    from .phoneme import text_to_phoneme, text_to_visemes
except ImportError:
    from speech import speech_to_text, get_model
    from emotion import detect_emotion, get_emotion_pipeline
    from phoneme import text_to_phoneme, text_to_visemes

app = FastAPI()

@app.on_event("startup")
async def startup_event():
    def preload_models():
        print("Preloading models (this may take a while if downloading...)")
        get_model()
        get_emotion_pipeline()
        print("Models loaded.")
    
    threading.Thread(target=preload_models, daemon=True).start()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

ROOT_DIR = Path(__file__).resolve().parents[1]
FRONTEND_DIR = ROOT_DIR / "frontend"


@app.get("/")
def home():
    return {
        "message": "Real-Time Speech-to-3D Avatar backend is working",
        "websocket": "/ws",
        "frontend": "/app",
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    chunk_index = 0

    while True:
        try:
            audio_bytes = await websocket.receive_bytes()
        except WebSocketDisconnect:
            break

        with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        try:
            text, language = speech_to_text(tmp_path)

            translated_text = ""
            if text:
                try:
                    translated_text = GoogleTranslator(source="auto", target="en").translate(text)
                except Exception:
                    translated_text = text

            emotion = detect_emotion(translated_text) if translated_text else "neutral"
            phonemes = text_to_phoneme(translated_text or text)
            visemes = text_to_visemes(translated_text or text)

            os.remove(tmp_path)
            chunk_index += 1

            response = {
                "text": text,
                "english_text": translated_text,
                "language": language,
                "emotion": emotion,
                "phonemes": phonemes,
                "visemes": visemes,
                "chunk_index": chunk_index,
            }
            await websocket.send_text(json.dumps(response, ensure_ascii=False))

        except Exception as e:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

            error_response = {
                "text": "",
                "language": "en",
                "emotion": "neutral",
                "chunk_index": chunk_index,
                "error": str(e),
            }
            await websocket.send_text(json.dumps(error_response, ensure_ascii=False))


if FRONTEND_DIR.exists():
    app.mount("/app", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
