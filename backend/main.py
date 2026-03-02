from fastapi import FastAPI, WebSocket
import whisper
from transformers import pipeline
import json
import tempfile
import os

app = FastAPI()
@app.get("/")
def home():
    return {"message": "Backend is working 🚀"}

# Load Whisper Model
model = whisper.load_model("base")

# Load Emotion Model
emotion_pipeline = pipeline("text-classification",
                            model="j-hartmann/emotion-english-distilroberta-base",
                            return_all_scores=False)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    while True:
        audio_bytes = await websocket.receive_bytes()

        # Save temp audio file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        # Speech Recognition
        result = model.transcribe(tmp_path,language="en")
        text = result["text"]
        language = "en"

        # Emotion Detection
        emotion_result = emotion_pipeline(text)
        emotion = emotion_result[0]['label']

        os.remove(tmp_path)

        response = {
            "text": text,
            "language": language,
            "emotion": emotion
        }

        await websocket.send_text(json.dumps(response))