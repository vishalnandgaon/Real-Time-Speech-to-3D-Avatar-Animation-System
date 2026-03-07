import whisper

model = whisper.load_model("small")

def speech_to_text(audio_path):
    result = model.transcribe(audio_path,task="transcribe")
    return result["text"], result["language"]