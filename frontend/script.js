let mediaRecorder;
let socket;
let mediaStream;
let audioContext;
let analyser;
let micSource;
let mouthFrameId;
let isStreaming = false;
let outputSpeaking = false;
let segmentTimer = null;
let segmentChunks = [];

let originalTranscript = "";
let englishTranscript = "";
let lastEmotion = "neutral";
let lastChunkIndex = 0;
let lastLanguageCode = "en";
let spokenTextSet = new Set();
let emptyChunkStreak = 0;
let speakingHoldTimer = null;
let visemeTimerIds = [];

const MIN_CHUNK_BYTES = 600;
const CHUNK_MS = 1800;

const languageNameMap = {
    en: "English",
    hi: "Hindi",
    ta: "Tamil",
    te: "Telugu",
    bn: "Bengali",
    mr: "Marathi",
    gu: "Gujarati",
    kn: "Kannada",
    ml: "Malayalam",
    pa: "Punjabi",
    ur: "Urdu",
    es: "Spanish",
    fr: "French",
    de: "German",
    it: "Italian",
    pt: "Portuguese",
    ru: "Russian",
    ja: "Japanese",
    ko: "Korean",
    zh: "Chinese",
    ar: "Arabic",
};

function getLanguageDisplay(code) {
    const normalized = (code || "en").toLowerCase();
    const name = languageNameMap[normalized] || normalized.toUpperCase();
    return `${name} (${normalized})`;
}

function setStatus(text, live) {
    const statusBadge = document.getElementById("statusBadge");
    const statusText = statusBadge.querySelector(".status-text");
    if (statusText) statusText.textContent = text;
    else statusBadge.textContent = text;
    statusBadge.classList.remove("live", "idle");
    statusBadge.classList.add(live ? "live" : "idle");
}

function updateUI() {
    const origEl = document.getElementById("originalText");
    const engEl = document.getElementById("englishText");
    
    origEl.textContent = originalTranscript || "Waiting for speech input...";
    if (originalTranscript) origEl.classList.remove("placeholder");
    else origEl.classList.add("placeholder");

    engEl.textContent = englishTranscript || "Translation will appear here...";
    if (englishTranscript) engEl.classList.remove("placeholder");
    else engEl.classList.add("placeholder");

    document.getElementById("emotionValue").textContent = lastEmotion || "Neutral";
    
    const chunkVal = document.getElementById("chunkValue");
    if (chunkVal) chunkVal.textContent = String(lastChunkIndex);
    
    document.getElementById("languageValue").textContent = getLanguageDisplay(lastLanguageCode);
}

function appendUnique(base, piece) {
    const clean = (piece || "").trim();
    if (!clean) return base;
    if (!base) return clean;
    if (base.toLowerCase().endsWith(clean.toLowerCase())) return base;
    return `${base} ${clean}`.trim();
}

function pickVoiceForLanguage(langCode) {
    const allVoices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    if (!allVoices.length) return null;
    const lc = (langCode || "en").toLowerCase();

    let voice = allVoices.find((v) => v.lang && v.lang.toLowerCase().startsWith(lc));
    if (voice) return voice;

    const prefix = lc.split("-")[0];
    voice = allVoices.find((v) => v.lang && v.lang.toLowerCase().startsWith(prefix));
    if (voice) return voice;

    return allVoices.find((v) => v.default) || allVoices[0];
}

function setAvatarOutputSpeaking(isSpeaking) {
    outputSpeaking = isSpeaking;
    if (window.setAvatarSpeaking) {
        window.setAvatarSpeaking(isSpeaking);
    }
}

function getSocketUrl() {
    if (window.location.protocol === "http:" || window.location.protocol === "https:") {
        const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        return `${wsProtocol}//${window.location.host}/ws`;
    }
    return "ws://127.0.0.1:8000/ws";
}

function clearAvatarVisemes() {
    visemeTimerIds.forEach((timerId) => clearTimeout(timerId));
    visemeTimerIds = [];
    if (window.setAvatarViseme) {
        window.setAvatarViseme("sil", 0);
    }
}

function playAvatarVisemes(frames) {
    if (!Array.isArray(frames) || !frames.length || !window.setAvatarViseme) return;
    clearAvatarVisemes();
    for (const frame of frames) {
        const offset = Math.max(0, Number(frame.offset_ms || 0));
        const duration = Math.max(80, Number(frame.duration_ms || 100));
        const intensity = Math.max(0, Math.min(1, Number(frame.intensity ?? 1)));
        const viseme = frame.viseme || "aa";
        visemeTimerIds.push(setTimeout(() => {
            window.setAvatarViseme(viseme, intensity);
        }, offset));
        visemeTimerIds.push(setTimeout(() => {
            window.setAvatarViseme("sil", 0);
        }, offset + duration));
    }
}

function pulseAvatarSpeaking(ms = 1400) {
    setAvatarOutputSpeaking(true);
    if (speakingHoldTimer) {
        clearTimeout(speakingHoldTimer);
    }
    speakingHoldTimer = setTimeout(() => {
        if (!window.speechSynthesis || !window.speechSynthesis.speaking) {
            setAvatarOutputSpeaking(false);
        }
    }, ms);
}

function speakChunkInInputLanguage(text, languageCode, visemes) {
    const clean = (text || "").trim();
    if (!clean || clean.length < 2 || !window.speechSynthesis) return;
    if (spokenTextSet.has(clean)) return;
    spokenTextSet.add(clean);

    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = languageCode || "en";
    const chosenVoice = pickVoiceForLanguage(languageCode);
    if (chosenVoice) {
        utterance.voice = chosenVoice;
        utterance.lang = chosenVoice.lang || utterance.lang;
    }
    utterance.rate = 1.02;
    utterance.pitch = 1.0;
    utterance.onstart = () => {
        setAvatarOutputSpeaking(true);
        if (visemes) playAvatarVisemes(visemes);
    };
    utterance.onend = () => setAvatarOutputSpeaking(false);
    utterance.onerror = () => setAvatarOutputSpeaking(false);
    window.speechSynthesis.speak(utterance);
}

function startMicMouthDrive() {
    // Disabled mic mouth drive as requested so avatar doesn't move when user speaks
    // Visemes and forceSpeaking handle the avatar's lip sync instead.
}

function stopMicMouthDrive() {
    if (window.driveAvatarMouth) {
        window.driveAvatarMouth(0);
    }
}

async function setupMicAudioAnalysis(stream) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    micSource = audioContext.createMediaStreamSource(stream);
    micSource.connect(analyser);
}

async function flushSegmentToSocket() {
    if (!isStreaming) return;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (!segmentChunks.length) return;

    const blob = new Blob(segmentChunks, { type: "audio/webm;codecs=opus" });
    segmentChunks = [];
    if (blob.size < MIN_CHUNK_BYTES) return;

    const buffer = await blob.arrayBuffer();
    socket.send(buffer);
}

function connectSocket() {
    return new Promise((resolve, reject) => {
        socket = new WebSocket(getSocketUrl());
        socket.onopen = () => resolve();
        socket.onerror = (error) => reject(error);
        socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.error) {
                setStatus(`Backend warning: ${data.error}`, true);
                return;
            }

            lastChunkIndex = data.chunk_index || lastChunkIndex;
            lastLanguageCode = (data.language || lastLanguageCode).toLowerCase();
            if (data.emotion) {
                lastEmotion = data.emotion;
                if (window.updateAvatarEmotion) {
                    window.updateAvatarEmotion(lastEmotion);
                }
            }

            if (data.text) {
                emptyChunkStreak = 0;
                originalTranscript = appendUnique(originalTranscript, data.text);
                // Delaying avatar speaking & visemes until utterance.onstart
                speakChunkInInputLanguage(data.text, lastLanguageCode, data.visemes);
            } else {
                emptyChunkStreak += 1;
            }
            if (data.english_text) {
                englishTranscript = appendUnique(englishTranscript, data.english_text);
            }

            if (emptyChunkStreak >= 3 && !originalTranscript) {
                setStatus("Live - no speech detected yet", true);
            } else {
                setStatus("Live", true);
            }
            updateUI();
        };
    });
}

async function start() {
    const startBtn = document.getElementById("startBtn");
    const stopBtn = document.getElementById("stopBtn");

    startBtn.disabled = true;
    stopBtn.disabled = true;
    originalTranscript = "";
    englishTranscript = "";
    lastEmotion = "neutral";
    lastChunkIndex = 0;
    lastLanguageCode = "en";
    spokenTextSet = new Set();
    emptyChunkStreak = 0;
    updateUI();
    setStatus("Connecting", false);

    try {
        if (socket && socket.readyState === WebSocket.OPEN) socket.close();

        await connectSocket();
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        await setupMicAudioAnalysis(mediaStream);

        const preferredMime = "audio/webm;codecs=opus";
        const recorderOptions = MediaRecorder.isTypeSupported(preferredMime) ? { mimeType: preferredMime } : undefined;
        mediaRecorder = new MediaRecorder(mediaStream, recorderOptions);
        mediaRecorder.ondataavailable = (event) => {
            if (!isStreaming || !event.data || event.data.size === 0) return;
            segmentChunks.push(event.data);
        };
        mediaRecorder.onstop = async () => {
            await flushSegmentToSocket();
            if (!isStreaming) return;
            try {
                mediaRecorder.start();
            } catch (_) {}
        };

        isStreaming = true;
        mediaRecorder.start();
        segmentTimer = setInterval(() => {
            if (!isStreaming) return;
            if (mediaRecorder && mediaRecorder.state === "recording") {
                try {
                    mediaRecorder.stop();
                } catch (_) {}
            }
        }, CHUNK_MS);
        startMicMouthDrive();

        stopBtn.disabled = false;
        setStatus("Live", true);
    } catch (err) {
        setStatus(`Error: ${err.message || err}`, false);
        startBtn.disabled = false;
    }
}

function stop() {
    const startBtn = document.getElementById("startBtn");
    const stopBtn = document.getElementById("stopBtn");

    isStreaming = false;
    outputSpeaking = false;
    stopMicMouthDrive();

    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
    if (segmentTimer) {
        clearInterval(segmentTimer);
        segmentTimer = null;
    }
    segmentChunks = [];
    if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
        mediaStream = null;
    }
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    if (socket && socket.readyState === WebSocket.OPEN) socket.close();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (window.setAvatarSpeaking) window.setAvatarSpeaking(false);
    clearAvatarVisemes();
    if (speakingHoldTimer) {
        clearTimeout(speakingHoldTimer);
        speakingHoldTimer = null;
    }

    stopBtn.disabled = true;
    startBtn.disabled = false;
    setStatus("Stopped", false);
}

if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = () => {};
}
