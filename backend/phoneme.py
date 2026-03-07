import eng_to_ipa as ipa

def text_to_phoneme(text):
    return ipa.convert(text)