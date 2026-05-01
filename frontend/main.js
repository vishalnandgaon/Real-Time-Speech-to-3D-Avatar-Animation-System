import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let scene, camera, renderer, avatar, clock;
let faceParts = {};
let socket;
let mediaRecorder;
let activeStream;
let audioChunks = [];
let mouthTimer;
let speechMouthTimer;
let availableVoices = [];
let playbackAudioContext;
let playbackSource;
let playbackAnalyser;
let playbackLipSyncTimer;
let blendState = createBlendState();
let blendTarget = createBlendState();

const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
const socketUrl = `${protocol}://${location.host}/audio-stream`;

const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const statusText = document.getElementById('status-text');
const transcriptEl = document.getElementById('transcript');
const englishTranscriptEl = document.getElementById('english-transcript');
const emotionEl = document.getElementById('emotion-val');
const languageEl = document.getElementById('language-val');
const playbackEl = document.getElementById('voice-playback');

async function init() {
    scene = new THREE.Scene();
    clock = new THREE.Clock();

    const container = document.getElementById('avatar-container');
    const width = container.clientWidth;
    const height = container.clientHeight;

    camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 0.9, 4.1);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));

    const keyLight = new THREE.SpotLight(0xffffff, 1.4);
    keyLight.position.set(2, 4, 3);
    scene.add(keyLight);

    const fillLight = new THREE.PointLight(0x22d3ee, 1, 10);
    fillLight.position.set(-2, 2, 2);
    scene.add(fillLight);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0.72, 0);
    controls.update();

    avatar = createHumanFaceAvatar();
    scene.add(avatar);
    animate();

    window.addEventListener('resize', onWindowResize);
    startBtn.addEventListener('click', startListening);
    stopBtn.addEventListener('click', stopListening);

    if ('speechSynthesis' in window) {
        availableVoices = window.speechSynthesis.getVoices();
        window.speechSynthesis.onvoiceschanged = () => {
            availableVoices = window.speechSynthesis.getVoices();
        };
    }
}

async function startListening() {
    try {
        stopAvatarSpeech();
        playbackEl.pause();
        setStatus('Requesting microphone...');
        transcriptEl.innerText = 'Speak now, then press Stop.';
        englishTranscriptEl.innerText = 'English conversion will appear after analysis.';
        emotionEl.innerText = 'Listening';
        languageEl.innerText = 'Listening';

        socket = new WebSocket(socketUrl);
        await waitForSocket(socket);

        activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioChunks = [];

        const mimeType = getSupportedMimeType();
        mediaRecorder = new MediaRecorder(activeStream, mimeType ? { mimeType } : undefined);

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = sendRecording;
        socket.onmessage = handleServerMessage;
        socket.onerror = () => showError('WebSocket error. Is the backend running?');

        mediaRecorder.start();
        document.body.classList.add('recording');
        startBtn.disabled = true;
        stopBtn.disabled = false;
        setStatus('Listening...');
    } catch (error) {
        console.error("Start listening error:", error);
        showError(`Error: ${error.message}. Try the direct link.`);
        resetControls();
    }
}

function stopListening() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        return;
    }

    setStatus('Analyzing...');
    stopBtn.disabled = true;
    mediaRecorder.stop();
    stopTracks();
}

async function sendRecording() {
    const type = mediaRecorder.mimeType || 'audio/webm';
    const audioBlob = new Blob(audioChunks, { type });
    audioChunks = [];

    playbackEl.src = URL.createObjectURL(audioBlob);
    playbackEl.hidden = false;
    playbackEl.play().then(startPlaybackLipSync).catch(() => animateMouth(1400));

    if (socket?.readyState === WebSocket.OPEN) {
        socket.send(await audioBlob.arrayBuffer());
    } else {
        showError('Connection closed before audio could be sent.');
        resetControls();
    }
}

function handleServerMessage(event) {
    const data = JSON.parse(event.data);

    if (data.error) {
        console.warn(data.error);
    }

    transcriptEl.innerText = data.text;
    englishTranscriptEl.innerText = data.english_text || 'English conversion unavailable.';
    emotionEl.innerText = data.emotion || 'unknown';
    languageEl.innerText = data.language_name
        ? `${data.language_name} (${data.language})`
        : data.language || 'unknown';

    applyExpression(data.emotion);
    resetControls();
    speakAsAvatar(data);
}

function waitForSocket(ws) {
    return new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = (e) => {
            console.error("Socket error details:", e);
            reject(new Error('Connection failed. This might be a network block or server startup issue.'));
        };
        ws.onclose = (e) => {
            console.log("Socket closed:", e.code, e.reason);
        };
    });
}

function getSupportedMimeType() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    return types.find((type) => MediaRecorder.isTypeSupported(type));
}

function showError(message) {
    setStatus('Error');
    transcriptEl.innerText = message;
    englishTranscriptEl.innerText = 'English conversion unavailable.';
    emotionEl.innerText = 'unknown';
    languageEl.innerText = 'unknown';
}

function resetControls() {
    document.body.classList.remove('recording');
    startBtn.disabled = false;
    stopBtn.disabled = true;
    stopTracks();

    if (socket?.readyState === WebSocket.OPEN) {
        socket.close();
    }
}

function speakAsAvatar(data) {
    const text = cleanSpeechText(data.text);

    if (!text) {
        setStatus('Done');
        return;
    }

    if (!playbackEl.paused && !playbackEl.ended) {
        setStatus('Matching lips to your voice...');
        playbackEl.addEventListener('ended', () => speakAsAvatar(data), { once: true });
        return;
    }

    if (!('speechSynthesis' in window)) {
        animateMouth(estimateSpeechDuration(text));
        setStatus('Done');
        return;
    }

    stopAvatarSpeech();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = getBrowserLanguage(data.language);
    utterance.voice = chooseVoice(utterance.lang);
    utterance.rate = 0.92;
    utterance.pitch = getPitchForEmotion(data.emotion);
    utterance.volume = 1;

    utterance.onstart = () => {
        setStatus('Avatar speaking...');
        startSpeechMouthAnimation(text);
    };

    utterance.onboundary = () => {
        setMouthOpen(0.85);
        setTimeout(() => setMouthOpen(0.25), 90);
    };

    utterance.onend = () => {
        stopSpeechMouthAnimation();
        setStatus('Done');
    };

    utterance.onerror = () => {
        stopSpeechMouthAnimation();
        setStatus('Done');
    };

    window.speechSynthesis.speak(utterance);
}

function cleanSpeechText(text = '') {
    const trimmed = text.trim();
    const blockedMessages = ['No speech detected.', 'Could not analyze this recording.'];

    return blockedMessages.includes(trimmed) ? '' : trimmed;
}

function getBrowserLanguage(languageCode = '') {
    const languageMap = {
        en: 'en-US',
        hi: 'hi-IN',
        ur: 'ur-IN',
        ta: 'ta-IN',
        te: 'te-IN',
        bn: 'bn-IN',
        mr: 'mr-IN',
        gu: 'gu-IN',
        kn: 'kn-IN',
        ml: 'ml-IN',
        pa: 'pa-IN',
        es: 'es-ES',
        fr: 'fr-FR',
        de: 'de-DE',
        it: 'it-IT',
        ja: 'ja-JP',
        ko: 'ko-KR',
        zh: 'zh-CN',
    };

    return languageMap[languageCode] || navigator.language || 'en-US';
}

function chooseVoice(lang) {
    if (!availableVoices.length) {
        availableVoices = window.speechSynthesis.getVoices();
    }

    const language = lang.toLowerCase();
    const baseLanguage = language.split('-')[0];

    return availableVoices.find((voice) => voice.lang.toLowerCase() === language)
        || availableVoices.find((voice) => voice.lang.toLowerCase().startsWith(baseLanguage))
        || availableVoices.find((voice) => voice.default)
        || availableVoices[0]
        || null;
}

function getPitchForEmotion(emotion = '') {
    const normalized = emotion.toLowerCase();

    if (normalized.includes('happy') || normalized.includes('joy') || normalized.includes('surprise')) {
        return 1.12;
    }

    if (normalized.includes('sad')) {
        return 0.86;
    }

    if (normalized.includes('angry')) {
        return 0.95;
    }

    return 1;
}

function startSpeechMouthAnimation(text) {
    clearInterval(speechMouthTimer);

    const syllableCount = Math.max(6, text.split(/[aeiou]+/i).length);
    const speed = THREE.MathUtils.clamp(28 - syllableCount * 0.18, 16, 28);
    const startedAt = Date.now();

    speechMouthTimer = setInterval(() => {
        const elapsed = Date.now() - startedAt;
        const vowelPulse = Math.abs(Math.sin(elapsed / speed));
        const consonantPulse = Math.abs(Math.sin(elapsed / (speed * 0.55))) * 0.25;
        const widePulse = Math.abs(Math.sin(elapsed / (speed * 1.8))) * 0.35;
        const puckerPulse = Math.abs(Math.sin(elapsed / (speed * 2.7))) * 0.22;

        setLipSyncShape({
            open: THREE.MathUtils.clamp(vowelPulse * 0.7 + consonantPulse, 0.08, 0.95),
            wide: widePulse,
            pucker: puckerPulse,
        });
    }, 34);
}

function stopSpeechMouthAnimation() {
    clearInterval(speechMouthTimer);
    setLipSyncShape({ open: 0, wide: 0, pucker: 0 });
}

function stopAvatarSpeech() {
    clearInterval(speechMouthTimer);
    clearInterval(mouthTimer);
    clearInterval(playbackLipSyncTimer);

    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }

    setLipSyncShape({ open: 0, wide: 0, pucker: 0 });
}

function stopTracks() {
    activeStream?.getTracks().forEach((track) => track.stop());
    activeStream = null;
}

function setStatus(message) {
    statusText.innerText = message;
}

function onWindowResize() {
    const container = document.getElementById('avatar-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    if (avatar) {
        avatar.rotation.y = Math.sin(Date.now() * 0.001) * 0.04;
        avatar.position.y = Math.sin(Date.now() * 0.0014) * 0.015;
        updateFaceBlends(delta);
        blinkAvatar();
    }

    renderer.render(scene, camera);
}

function blinkAvatar() {
    const blinkValue = Math.sin(Date.now() * 0.005) > 0.98 ? 1 : 0;

    if (faceParts.leftEye && faceParts.rightEye) {
        const eyeScale = THREE.MathUtils.lerp(faceParts.leftEye.scale.y, blinkValue ? 0.08 : 1, 0.35);
        faceParts.leftEye.scale.y = eyeScale;
        faceParts.rightEye.scale.y = eyeScale;
        return;
    }

    avatar.traverse((child) => {
        if (!child.isMesh || !child.morphTargetDictionary) return;

        const blinkL = child.morphTargetDictionary.eyeBlinkLeft;
        const blinkR = child.morphTargetDictionary.eyeBlinkRight;

        if (blinkL !== undefined) {
            child.morphTargetInfluences[blinkL] = THREE.MathUtils.lerp(child.morphTargetInfluences[blinkL], blinkValue, 0.5);
        }

        if (blinkR !== undefined) {
            child.morphTargetInfluences[blinkR] = THREE.MathUtils.lerp(child.morphTargetInfluences[blinkR], blinkValue, 0.5);
        }
    });
}

function animateMouth(duration = 1000) {
    if (!avatar) return;

    clearInterval(mouthTimer);
    const startTime = Date.now();

    mouthTimer = setInterval(() => {
        const elapsed = Date.now() - startTime;

        if (elapsed > duration) {
            clearInterval(mouthTimer);
            setMouthOpen(0);
            return;
        }

        setMouthOpen(Math.abs(Math.sin(elapsed * 0.018)) * 0.75);
    }, 32);
}

function startPlaybackLipSync() {
    clearInterval(playbackLipSyncTimer);

    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
            throw new Error('Web Audio API is not available.');
        }

        playbackAudioContext ||= new AudioContextClass();

        if (!playbackSource) {
            playbackSource = playbackAudioContext.createMediaElementSource(playbackEl);
            playbackAnalyser = playbackAudioContext.createAnalyser();
            playbackAnalyser.fftSize = 256;
            playbackSource.connect(playbackAnalyser);
            playbackAnalyser.connect(playbackAudioContext.destination);
        }

        playbackAudioContext.resume();
    } catch (error) {
        console.warn('Audio analyser unavailable:', error);
        animateMouth(Math.max(1200, playbackEl.duration * 1000 || 1400));
        return;
    }

    const samples = new Uint8Array(playbackAnalyser.frequencyBinCount);

    playbackLipSyncTimer = setInterval(() => {
        if (playbackEl.paused || playbackEl.ended) {
            clearInterval(playbackLipSyncTimer);
            setLipSyncShape({ open: 0, wide: 0, pucker: 0 });
            return;
        }

        playbackAnalyser.getByteFrequencyData(samples);

        const lowEnergy = averageRange(samples, 2, 18) / 255;
        const midEnergy = averageRange(samples, 18, 58) / 255;
        const highEnergy = averageRange(samples, 58, 96) / 255;
        const open = THREE.MathUtils.clamp(lowEnergy * 1.8 + midEnergy * 0.65, 0.04, 1);
        const wide = THREE.MathUtils.clamp(midEnergy * 1.45, 0, 0.8);
        const pucker = THREE.MathUtils.clamp((lowEnergy - highEnergy) * 0.8, 0, 0.45);

        setLipSyncShape({ open, wide, pucker });
    }, 32);
}

function averageRange(values, start, end) {
    let total = 0;
    let count = 0;

    for (let i = start; i < Math.min(end, values.length); i += 1) {
        total += values[i];
        count += 1;
    }

    return count ? total / count : 0;
}

function estimateSpeechDuration(text) {
    return THREE.MathUtils.clamp(text.length * 72, 1000, 9000);
}

function applyExpression(emotion = '') {
    const normalized = emotion.toLowerCase();
    const happy = normalized.includes('joy') || normalized.includes('happy');
    const sad = normalized.includes('sad');
    const surprise = normalized.includes('surprise');
    const angry = normalized.includes('angry');
    const fear = normalized.includes('fear') || normalized.includes('anxious') || normalized.includes('scared');

    const smile = happy ? 0.85 : 0;
    const frown = sad ? 0.65 : 0;

    setProceduralExpression({
        smile,
        frown,
        surprised: surprise ? 0.85 : 0,
        angry: angry ? 0.85 : 0,
        fear: fear ? 0.7 : 0,
        eyeSquint: happy ? 0.35 : angry ? 0.25 : 0,
        cheekRaise: happy ? 0.45 : 0,
    });
    setMorphValue(['mouthSmileLeft', 'mouthSmileRight'], smile);
    setMorphValue(['mouthFrownLeft', 'mouthFrownRight'], frown);
}

function createHumanFaceAvatar() {
    const group = new THREE.Group();
    group.position.set(0, 0.82, 0);

    const skin = new THREE.MeshStandardMaterial({ color: 0xd9a47f, roughness: 0.62, metalness: 0.02 });
    const skinShadow = new THREE.MeshStandardMaterial({ color: 0xc58b6b, roughness: 0.75 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x17120f, roughness: 0.9 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35 });
    const iris = new THREE.MeshStandardMaterial({ color: 0x2f5f8f, roughness: 0.2 });
    const pupil = new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: 0.25 });
    const lip = new THREE.MeshStandardMaterial({ color: 0x9f4d5a, roughness: 0.55 });
    const mouthDark = new THREE.MeshStandardMaterial({ color: 0x1f1115, roughness: 0.7 });
    const blush = new THREE.MeshStandardMaterial({ color: 0xe8a0a6, roughness: 0.72, transparent: true, opacity: 0.38 });
    const shirt = new THREE.MeshStandardMaterial({ color: 0x243b53, roughness: 0.65 });

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.43, 48, 48), skin);
    head.scale.set(0.82, 1.08, 0.72);
    head.position.y = 0.42;
    group.add(head);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.32, 32), skinShadow);
    neck.position.y = -0.08;
    group.add(neck);

    const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.48, 0.45, 10, 32), shirt);
    shoulders.rotation.z = Math.PI / 2;
    shoulders.position.y = -0.36;
    group.add(shoulders);

    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.44, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.56), hair);
    hairCap.scale.set(0.86, 0.72, 0.74);
    hairCap.position.set(0, 0.73, 0.01);
    group.add(hairCap);

    for (let i = 0; i < 9; i += 1) {
        const lock = new THREE.Mesh(new THREE.SphereGeometry(0.08, 18, 18), hair);
        lock.scale.set(0.85, 1.35, 0.55);
        lock.position.set(-0.28 + i * 0.07, 0.74 - Math.abs(i - 4) * 0.012, 0.24);
        lock.rotation.z = (i - 4) * 0.12;
        group.add(lock);
    }

    faceParts.leftEye = createEye(-0.16, white, iris, pupil);
    faceParts.rightEye = createEye(0.16, white, iris, pupil);
    group.add(faceParts.leftEye, faceParts.rightEye);

    faceParts.leftLid = createLid(-0.16, skinShadow);
    faceParts.rightLid = createLid(0.16, skinShadow);
    group.add(faceParts.leftLid, faceParts.rightLid);

    faceParts.leftBrow = createBrow(-0.16, hair);
    faceParts.rightBrow = createBrow(0.16, hair);
    group.add(faceParts.leftBrow, faceParts.rightBrow);

    faceParts.leftCheek = createCheek(-0.2, blush);
    faceParts.rightCheek = createCheek(0.2, blush);
    group.add(faceParts.leftCheek, faceParts.rightCheek);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.18, 24), skinShadow);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0.4, 0.34);
    group.add(nose);

    const leftEar = createEar(-0.37, skin, skinShadow);
    const rightEar = createEar(0.37, skin, skinShadow);
    group.add(leftEar, rightEar);

    faceParts.mouthCavity = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.035, 0.012), mouthDark);
    faceParts.mouthCavity.position.set(0, 0.158, 0.375);
    group.add(faceParts.mouthCavity);

    faceParts.mouth = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.032, 0.018), lip);
    faceParts.mouth.position.set(0, 0.185, 0.382);
    group.add(faceParts.mouth);

    faceParts.lowerLip = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.026, 0.016), lip);
    faceParts.lowerLip.position.set(0, 0.13, 0.378);
    group.add(faceParts.lowerLip);

    const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.3, 32, 16), skin);
    jaw.scale.set(0.82, 0.32, 0.56);
    jaw.position.set(0, 0.08, 0.02);
    group.add(jaw);

    return group;
}

function createEye(x, white, iris, pupil) {
    const eye = new THREE.Group();
    eye.position.set(x, 0.49, 0.335);

    const eyeball = new THREE.Mesh(new THREE.SphereGeometry(0.072, 28, 16), white);
    eyeball.scale.set(1.28, 0.72, 0.25);

    const irisMesh = new THREE.Mesh(new THREE.SphereGeometry(0.028, 18, 12), iris);
    irisMesh.position.z = 0.045;

    const pupilMesh = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), pupil);
    pupilMesh.position.z = 0.066;

    eye.add(eyeball, irisMesh, pupilMesh);
    return eye;
}

function createBrow(x, material) {
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.024, 0.026), material);
    brow.position.set(x, 0.595, 0.34);
    brow.rotation.z = x < 0 ? -0.1 : 0.1;
    return brow;
}

function createLid(x, material) {
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.018, 0.018), material);
    lid.position.set(x, 0.53, 0.382);
    lid.scale.y = 0.08;
    return lid;
}

function createCheek(x, material) {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.07, 18, 12), material);
    cheek.scale.set(1.4, 0.48, 0.14);
    cheek.position.set(x, 0.29, 0.376);
    return cheek;
}

function createEar(x, skin, innerSkin) {
    const ear = new THREE.Group();
    ear.position.set(x, 0.43, 0.02);

    const outer = new THREE.Mesh(new THREE.SphereGeometry(0.08, 24, 16), skin);
    outer.scale.set(0.55, 1.05, 0.24);

    const inner = new THREE.Mesh(new THREE.SphereGeometry(0.045, 18, 12), innerSkin);
    inner.scale.set(0.45, 0.75, 0.12);
    inner.position.z = 0.015;

    ear.add(outer, inner);
    return ear;
}

function setMouthOpen(value) {
    setLipSyncShape({ open: value });

    setMorphValue(['jawOpen', 'mouthOpen', 'viseme_aa'], value);
}

function setLipSyncShape({ open, wide, pucker }) {
    if (open !== undefined) blendTarget.mouthOpen = open;
    if (wide !== undefined) blendTarget.mouthWide = wide;
    if (pucker !== undefined) blendTarget.mouthPucker = pucker;
}

function setProceduralExpression({ smile, frown, surprised, angry, fear, eyeSquint, cheekRaise }) {
    if (!faceParts.mouth) return;

    blendTarget.smile = smile;
    blendTarget.frown = frown;
    blendTarget.surprise = surprised;
    blendTarget.anger = angry;
    blendTarget.fear = fear;
    blendTarget.eyeSquint = eyeSquint;
    blendTarget.cheekRaise = cheekRaise;
}

function createBlendState() {
    return {
        mouthOpen: 0,
        mouthWide: 0,
        mouthPucker: 0,
        smile: 0,
        frown: 0,
        surprise: 0,
        anger: 0,
        fear: 0,
        eyeSquint: 0,
        cheekRaise: 0,
    };
}

function updateFaceBlends(delta) {
    const ease = 1 - Math.exp(-delta * 12);

    Object.keys(blendState).forEach((key) => {
        blendState[key] = THREE.MathUtils.lerp(blendState[key], blendTarget[key], ease);
    });

    const open = blendState.mouthOpen;
    const wide = blendState.mouthWide;
    const pucker = blendState.mouthPucker;
    const smile = blendState.smile;
    const frown = blendState.frown;
    const surprise = blendState.surprise;
    const anger = blendState.anger;
    const fear = blendState.fear;
    const cheekRaise = blendState.cheekRaise;
    const eyeSquint = blendState.eyeSquint;

    if (faceParts.mouth) {
        faceParts.mouth.scale.x = 1 + wide * 0.45 + smile * 0.42 - pucker * 0.35 - frown * 0.08;
        faceParts.mouth.scale.y = 1 + open * 1.15 + surprise * 0.9;
        faceParts.mouth.position.y = 0.185 + smile * 0.024 - frown * 0.028 + surprise * 0.006;
        faceParts.mouth.position.z = 0.382 + pucker * 0.018;
        faceParts.mouth.rotation.x = frown * 0.3;
    }

    if (faceParts.lowerLip) {
        faceParts.lowerLip.scale.x = 1 + wide * 0.22 - pucker * 0.22;
        faceParts.lowerLip.position.y = 0.13 - open * 0.055 - frown * 0.018 + smile * 0.012;
        faceParts.lowerLip.position.z = 0.378 + pucker * 0.022;
    }

    if (faceParts.mouthCavity) {
        faceParts.mouthCavity.scale.x = 1 + wide * 0.32 - pucker * 0.24;
        faceParts.mouthCavity.scale.y = 0.25 + open * 2.8 + surprise * 1.4;
        faceParts.mouthCavity.visible = open > 0.035 || surprise > 0.1;
    }

    if (faceParts.leftBrow && faceParts.rightBrow) {
        faceParts.leftBrow.rotation.z = -0.1 - anger * 0.34 + surprise * 0.18 + fear * 0.12;
        faceParts.rightBrow.rotation.z = 0.1 + anger * 0.34 - surprise * 0.18 - fear * 0.12;
        faceParts.leftBrow.position.y = 0.595 + surprise * 0.048 + fear * 0.035 - anger * 0.026;
        faceParts.rightBrow.position.y = 0.595 + surprise * 0.048 + fear * 0.035 - anger * 0.026;
    }

    if (faceParts.leftLid && faceParts.rightLid) {
        const lidScale = 0.08 + eyeSquint * 1.7 + anger * 0.7 - surprise * 0.05;
        faceParts.leftLid.scale.y = THREE.MathUtils.clamp(lidScale, 0.04, 1.8);
        faceParts.rightLid.scale.y = THREE.MathUtils.clamp(lidScale, 0.04, 1.8);
        faceParts.leftLid.position.y = 0.53 - eyeSquint * 0.014 - anger * 0.01 + surprise * 0.012;
        faceParts.rightLid.position.y = 0.53 - eyeSquint * 0.014 - anger * 0.01 + surprise * 0.012;
    }

    if (faceParts.leftCheek && faceParts.rightCheek) {
        const cheekScale = 1 + cheekRaise * 0.75 + smile * 0.28;
        faceParts.leftCheek.scale.y = 0.48 * cheekScale;
        faceParts.rightCheek.scale.y = 0.48 * cheekScale;
        faceParts.leftCheek.position.y = 0.29 + cheekRaise * 0.025 + smile * 0.016;
        faceParts.rightCheek.position.y = 0.29 + cheekRaise * 0.025 + smile * 0.016;
    }
}

function setMorphValue(names, value) {
    avatar?.traverse((child) => {
        if (!child.isMesh || !child.morphTargetDictionary) return;

        names.forEach((name) => {
            const index = child.morphTargetDictionary[name];
            if (index !== undefined) {
                child.morphTargetInfluences[index] = value;
            }
        });
    });
}

init();
