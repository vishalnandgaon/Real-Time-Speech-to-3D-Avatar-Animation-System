import os

os.environ.setdefault("USE_TF", "0")

from transformers import AutoModelForSequenceClassification, AutoTokenizer, pipeline

MODEL_NAME = "j-hartmann/emotion-english-distilroberta-base"

emotion_pipeline = None


def get_emotion_pipeline():
    global emotion_pipeline

    if emotion_pipeline is not None:
        return emotion_pipeline

    try:
        tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, local_files_only=True)
        model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME, local_files_only=True)
        emotion_pipeline = pipeline("text-classification", model=model, tokenizer=tokenizer)
    except Exception:
        emotion_pipeline = False

    return emotion_pipeline


def detect_emotion(text):
    classifier = get_emotion_pipeline()

    if classifier:
        result = classifier(text)
        return result[0]["label"]

    return detect_emotion_with_keywords(text)


def detect_emotion_with_keywords(text):
    lowered = text.lower()

    emotion_words = {
        "happy": ["happy", "great", "good", "love", "awesome", "excellent", "joy", "glad"],
        "sad": ["sad", "bad", "upset", "cry", "hurt", "lonely", "depressed", "unhappy"],
        "angry": ["angry", "mad", "hate", "furious", "annoyed", "irritated"],
        "fear": ["afraid", "scared", "fear", "worried", "nervous", "anxious"],
        "surprise": ["surprised", "wow", "amazing", "shocked", "unexpected"],
    }

    for emotion, words in emotion_words.items():
        if any(word in lowered for word in words):
            return emotion

    return "neutral"
