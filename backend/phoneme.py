try:
    import eng_to_ipa as ipa
except Exception:
    ipa = None


VISEME_GROUPS = {
    "sil": set(" "),
    "aa": set("aɑɒʌəæeɛiɪoɔuʊ"),
    "ee": set("iyɪeɛ"),
    "oh": set("oɔuʊw"),
    "fv": set("fv"),
    "mbp": set("mbp"),
    "th": set("θð"),
    "ln": set("lrn"),
    "sz": set("szʃʒ"),
    "kg": set("kgqx"),
    "ch": set("tdʧʤcj"),
}


def text_to_phoneme(text):
    clean = (text or "").strip()
    if not clean:
        return ""
    if ipa is None:
        return clean.lower()
    try:
        return ipa.convert(clean)
    except Exception:
        return clean.lower()


def _char_to_viseme(char):
    c = (char or "").lower()
    for viseme, chars in VISEME_GROUPS.items():
        if c in chars:
            return viseme
    return "aa" if c.isalpha() else "sil"


def text_to_visemes(text, frame_ms=95, max_frames=90):
    phonemes = text_to_phoneme(text)
    frames = []
    last = None

    for char in phonemes:
        if char in "'ˈˌ.,!?;:-_()[]{}\"":
            viseme = "sil"
        else:
            viseme = _char_to_viseme(char)

        if viseme == last and frames:
            frames[-1]["duration_ms"] += frame_ms
        else:
            frames.append(
                {
                    "viseme": viseme,
                    "offset_ms": sum(f["duration_ms"] for f in frames),
                    "duration_ms": frame_ms,
                    "intensity": 0.0 if viseme == "sil" else 1.0,
                }
            )
            last = viseme

        if len(frames) >= max_frames:
            break

    if not frames:
        frames.append({"viseme": "sil", "offset_ms": 0, "duration_ms": frame_ms, "intensity": 0.0})

    return frames
