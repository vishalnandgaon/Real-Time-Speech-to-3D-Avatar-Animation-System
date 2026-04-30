emotion_pipeline = None
emotion_pipeline_loaded = False


def keyword_emotion_fallback(text):
    t = (text or "").lower()
    if any(w in t for w in ["happy", "great", "awesome", "love", "excited", "joy"]):
        return "joy"
    if any(w in t for w in ["sad", "upset", "hurt", "depressed", "cry"]):
        return "sadness"
    if any(w in t for w in ["angry", "mad", "hate", "annoyed", "frustrated"]):
        return "anger"
    if any(w in t for w in ["wow", "surprised", "shock", "amazing"]):
        return "surprise"
    if any(w in t for w in ["afraid", "fear", "scared", "nervous"]):
        return "fear"
    return "neutral"


def get_emotion_pipeline():
    global emotion_pipeline, emotion_pipeline_loaded
    if emotion_pipeline_loaded:
        return emotion_pipeline
    emotion_pipeline_loaded = True
    try:
        from transformers import pipeline

        emotion_pipeline = pipeline(
            "text-classification",
            model="j-hartmann/emotion-english-distilroberta-base",
        )
    except Exception:
        emotion_pipeline = None
    return emotion_pipeline


def detect_emotion(text):
    if not text or text.strip() == "":
        return "neutral"

    classifier = get_emotion_pipeline()
    if classifier is None:
        return keyword_emotion_fallback(text)

    try:
        result = classifier(text)
        if result:
            return result[0]["label"].lower()
        return "neutral"
    except Exception:
        return keyword_emotion_fallback(text)
