import whisper
from whisper.tokenizer import LANGUAGES

model = whisper.load_model("small")

def speech_to_text(audio_path):
    result = model.transcribe(audio_path, task="transcribe")
    language_code = result.get("language", "unknown")
    language_name = LANGUAGES.get(language_code, language_code)

    return {
        "text": result.get("text", "").strip(),
        "language": language_code,
        "language_name": language_name.title()
    }
