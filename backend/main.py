from fastapi import FastAPI, WebSocket
from deep_translator import GoogleTranslator
from speech import speech_to_text
from emotion import detect_emotion
import json
import tempfile
import os

app = FastAPI()

@app.get("/")
def home():
    return {"message": "Backend is working 🚀"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):

    await websocket.accept()

    while True:

        # Receive audio
        audio_bytes = await websocket.receive_bytes()

        # Save temp audio file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        # 🎤 Speech to Text
        text, language = speech_to_text(tmp_path)

        # 🌍 Translate to English (for emotion model)
        translated_text = GoogleTranslator(
            source='auto',
            target='en'
        ).translate(text)

        # 😊 Emotion Detection
        emotion = detect_emotion(translated_text)

        # Delete temp file
        os.remove(tmp_path)

        # Send response
        response = {
            "text": text,
            "language": language,
            "emotion": emotion
        }

        await websocket.send_text(
            json.dumps(response, ensure_ascii=False)
        )