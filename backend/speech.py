import os

model = None


def get_model():
    global model
    if model is None:
        import whisper

        model_name = os.getenv("WHISPER_MODEL", "small")
        model = whisper.load_model(model_name)
    return model

def speech_to_text(audio_path):
    try:
        result = get_model().transcribe(
            audio_path,
            task="transcribe",
            fp16=False,
            temperature=0.0,
            condition_on_previous_text=True,
            beam_size=5,
            best_of=5,
        )
        return result.get("text", "").strip(), result.get("language", "en")
    except Exception as e:
        # Some very short or malformed chunks cannot be decoded by ffmpeg.
        print(f"speech_to_text warning: {e}")
        return "", "en"
