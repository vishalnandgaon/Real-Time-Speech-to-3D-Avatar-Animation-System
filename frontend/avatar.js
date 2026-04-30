import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

let scene;
let camera;
let renderer;
let avatar;
let mixer;
let clock;
let jawBones = [];
let headBones = [];
let speakingLevel = 0;
let currentEmotion = "neutral";
let fallbackAvatar;
let forceSpeaking = false;
let t = 0;
let hasFaceControls = false;
let activeViseme = "sil";
let visemeIntensity = 0;

// Tears Particle System
let tearsParticleSystem;
let tearsGeometry;
let tearSpeeds = [];

function initAvatar() {
    scene = new THREE.Scene();
    scene.background = null; // transparent background to let CSS glow show

    const container = document.getElementById("avatar-container");
    const width = Math.max(320, container.clientWidth || window.innerWidth);
    const height = Math.max(320, container.clientHeight || 500);

    camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    // Move camera back to see the face properly
    camera.position.set(0, 0.2, 4.5);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    clock = new THREE.Clock();

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
    keyLight.position.set(2, 3, 4);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x88aaff, 1.2);
    fillLight.position.set(-2, 2, 3);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x40d38f, 0.8);
    rimLight.position.set(0, 4, -4);
    scene.add(rimLight);

    scene.add(new THREE.AmbientLight(0xffffff, 0.9));

    const ktx2Loader = new KTX2Loader();
    ktx2Loader.setTranscoderPath("https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/libs/basis/");
    ktx2Loader.detectSupport(renderer);

    const loader = new GLTFLoader();
    loader.setKTX2Loader(ktx2Loader);
    loader.setMeshoptDecoder(MeshoptDecoder);

    loader.load(
        new URL("./avatar.glb", import.meta.url).href,
        (gltf) => {
            avatar = gltf.scene;
            avatar.scale.set(0.6, 0.6, 0.6); // Reduced scale significantly
            avatar.position.set(0, -0.2, 0);
            scene.add(avatar);

            if (gltf.animations && gltf.animations.length) {
                mixer = new THREE.AnimationMixer(avatar);
                mixer.clipAction(gltf.animations[0]).play();
            }

            avatar.traverse((child) => {
                if (child.morphTargetDictionary && child.morphTargetInfluences) {
                    hasFaceControls = true;
                }
                if (child.isBone && /jaw|chin/i.test(child.name)) {
                    jawBones.push(child);
                    hasFaceControls = true;
                }
                if (child.isBone && /head|neck/i.test(child.name)) {
                    headBones.push(child);
                }
            });

            if (fallbackAvatar) {
                scene.remove(fallbackAvatar);
                fallbackAvatar = null;
            }
        },
        undefined,
        (error) => {
            console.error("Avatar load error:", error);
            createFallbackAvatar();
        }
    );

    initTears();
    animate();
}

function initTears() {
    const particleCount = 60;
    tearsGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    
    for(let i=0; i<particleCount; i++) {
        positions[i*3] = 0; 
        positions[i*3+1] = -100; // Start hidden below
        positions[i*3+2] = 0; 
        tearSpeeds.push(Math.random() * 0.8 + 0.5);
    }
    tearsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    // Create a glossy tear material
    const tearMaterial = new THREE.PointsMaterial({
        color: 0x88ccff,
        size: 0.04,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    
    tearsParticleSystem = new THREE.Points(tearsGeometry, tearMaterial);
    scene.add(tearsParticleSystem);
}

function createFallbackAvatar() {
    if (fallbackAvatar) return;

    const group = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0xf0c9a5 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 32, 32), skin);
    head.position.set(0, 1.5, 0);
    group.add(head);

    fallbackAvatar = group;
    scene.add(fallbackAvatar);
}

function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();
    if (mixer) mixer.update(delta);
    
    applyBehavioralIdle(delta);
    applyFacialState(delta);
    updateTears(delta);

    renderer.render(scene, camera);
}

function applyBehavioralIdle(delta) {
    const target = avatar || fallbackAvatar;
    if (!target) return;

    const emo = (currentEmotion || "neutral").toLowerCase();
    let breathSpeed = 1.0;
    let headTiltTarget = 0; 
    let bodySwayTarget = 0;

    if (emo === 'sadness' || emo === 'sad') {
        breathSpeed = 0.5;
        bodySwayTarget = 0.05; // slumped forward slightly
    } else if (emo === 'joy' || emo === 'happy') {
        breathSpeed = 1.3;
        bodySwayTarget = -0.02; // confident posture
    } else if (emo === 'anger' || emo === 'angry') {
        breathSpeed = 2.0;
        bodySwayTarget = 0.08; // leaning in aggressively
    } else if (emo === 'fear' || emo === 'surprise' || emo === 'surprised') {
        breathSpeed = 2.5;
        bodySwayTarget = -0.05; // pulling back
    }

    t += delta * breathSpeed;

    // Body idle
    // Keep breathing extremely subtle when not speaking to avoid looking completely frozen
    target.position.y = -0.2 + (forceSpeaking ? Math.sin(t * 1.4) * 0.01 : Math.sin(t * 1.4) * 0.002);
    
    let finalBodySwayTarget = bodySwayTarget;
    if (forceSpeaking) {
        finalBodySwayTarget += Math.sin(t * 4.5) * 0.04;
        target.rotation.y = Math.sin(t * 2.5) * 0.06;
        target.rotation.x = THREE.MathUtils.lerp(target.rotation.x, finalBodySwayTarget + Math.sin(t * 1.1) * 0.01, delta * 2);
    } else {
        target.rotation.y = THREE.MathUtils.lerp(target.rotation.y, 0, delta * 4);
        target.rotation.x = THREE.MathUtils.lerp(target.rotation.x, 0, delta * 4);
    }
}

function updateTears(delta) {
    if (!tearsParticleSystem) return;
    const positions = tearsGeometry.attributes.position.array;
    const isSad = (currentEmotion === "sadness" || currentEmotion === "sad");
    
    for(let i=0; i<60; i++) {
        let py = positions[i*3+1];
        if (isSad) {
            if (py < -1.5) { // Reset tear to eye height when it falls out of view
                const isLeft = Math.random() > 0.5;
                // Approximate eye locations for scale 0.6
                positions[i*3] = isLeft ? -0.15 - Math.random()*0.05 : 0.15 + Math.random()*0.05; 
                positions[i*3+1] = 0.4 + Math.random()*0.1; // y
                positions[i*3+2] = 0.3 + Math.random()*0.1; // z
                tearSpeeds[i] = Math.random() * 0.8 + 0.4;
            } else {
                positions[i*3+1] -= tearSpeeds[i] * delta; // Fall down
                // Trace cheek contour
                positions[i*3] += (positions[i*3] > 0 ? 1 : -1) * 0.01 * delta;
                positions[i*3+2] += 0.02 * delta; // Follow face roundness
            }
        } else {
            // Drop them quickly out of view if not sad
            positions[i*3+1] -= 3 * delta;
        }
    }
    tearsGeometry.attributes.position.needsUpdate = true;
}

function findMorphIndex(dict, candidates) {
    if (!dict) return -1;
    const entries = Object.entries(dict);
    for (const c of candidates) {
        const exact = entries.find(([k]) => k.toLowerCase() === c.toLowerCase());
        if (exact) return exact[1];
    }
    for (const c of candidates) {
        const contains = entries.find(([k]) => k.toLowerCase().includes(c.toLowerCase()));
        if (contains) return contains[1];
    }
    return -1;
}

function applyMorphSafe(child, candidates, weight) {
    if (!child.morphTargetDictionary || !child.morphTargetInfluences) return;
    const idx = findMorphIndex(child.morphTargetDictionary, candidates);
    if (idx >= 0 && idx < child.morphTargetInfluences.length) {
        // Blend smoothly towards the exact target weight without decay fighting it
        const current = child.morphTargetInfluences[idx];
        const target = Math.max(0, Math.min(1, weight));
        child.morphTargetInfluences[idx] = THREE.MathUtils.lerp(current, target, 0.4); 
    }
}

// ARKit Emotion Mappings
function emotionToWeights(emotion) {
    const e = (emotion || "neutral").toLowerCase();
    const base = {
        smile: 0, frown: 0, browInnerUp: 0, browDown: 0,
        cheekSquint: 0, mouthPress: 0, browOuterUp: 0,
        eyeWide: 0, eyeSquint: 0
    };
    
    if (e === "joy" || e === "happy") {
        return { ...base, smile: 0.8, cheekSquint: 0.7, browInnerUp: 0.1 };
    }
    if (e === "sadness" || e === "sad") {
        return { ...base, frown: 0.75, browInnerUp: 0.85, browDown: 0.1, eyeSquint: 0.3 };
    }
    if (e === "anger" || e === "angry") {
        return { ...base, browDown: 0.95, mouthPress: 0.8, eyeSquint: 0.5 };
    }
    if (e === "surprise" || e === "surprised" || e === "fear") {
        return { ...base, browOuterUp: 0.9, browInnerUp: 0.9, eyeWide: 0.85 };
    }
    return { ...base, smile: 0.15 }; // Neutral slight smile
}

// ARKit Viseme Mappings
function visemeToWeights(viseme, intensity) {
    const amount = Math.max(0, Math.min(1, intensity || 0));
    const v = (viseme || "sil").toLowerCase();
    const base = {
        jawOpen: 0, mouthFunnel: 0, mouthPucker: 0, 
        mouthStretch: 0, mouthRollUpper: 0, mouthRollLower: 0, 
        mouthUpperUp: 0, tongueOut: 0
    };
    
    if (v === "sil") return base;
    if (v === "mbp") return { ...base, mouthRollUpper: amount * 0.9, mouthRollLower: amount * 0.9, jawOpen: amount * 0.05 };
    if (v === "fv") return { ...base, mouthUpperUp: amount * 0.8, jawOpen: amount * 0.15 };
    if (v === "oh") return { ...base, mouthFunnel: amount * 0.8, mouthPucker: amount * 0.5, jawOpen: amount * 0.4 };
    if (v === "ee") return { ...base, mouthStretch: amount * 0.85, jawOpen: amount * 0.15 };
    if (v === "ln" || v === "th") return { ...base, tongueOut: amount * 0.75, jawOpen: amount * 0.25 };
    if (v === "sz" || v === "ch" || v === "kg") return { ...base, mouthStretch: amount * 0.45, jawOpen: amount * 0.3 };
    
    // Default (aa, ah)
    return { ...base, jawOpen: amount * 0.9 };
}

function applyFacialState(delta) {
    const target = avatar || fallbackAvatar;
    if (!target) return;

    const hasViseme = activeViseme !== "sil" && visemeIntensity > 0.1;
    const speechBoost = (forceSpeaking && !hasViseme) ? (0.35 + Math.abs(Math.sin(t * 16)) * 0.3) : 0;
    const vW = visemeToWeights(activeViseme, visemeIntensity);
    const eW = emotionToWeights(currentEmotion);
    
    const combinedJaw = Math.min(1, Math.max(speakingLevel * 1.5, speechBoost, vW.jawOpen));

    target.traverse((child) => {
        // Emotions
        applyMorphSafe(child, ["mouthSmileLeft", "mouthSmileRight", "mouthSmile", "smile"], eW.smile);
        applyMorphSafe(child, ["mouthFrownLeft", "mouthFrownRight", "mouthFrown", "frown"], eW.frown);
        applyMorphSafe(child, ["browInnerUp"], eW.browInnerUp);
        applyMorphSafe(child, ["browDownLeft", "browDownRight", "browDown"], eW.browDown);
        applyMorphSafe(child, ["cheekSquintLeft", "cheekSquintRight", "cheekSquint"], eW.cheekSquint);
        applyMorphSafe(child, ["mouthPressLeft", "mouthPressRight", "mouthPress"], eW.mouthPress);
        applyMorphSafe(child, ["browOuterUpLeft", "browOuterUpRight", "browOuterUp"], eW.browOuterUp);
        applyMorphSafe(child, ["eyeWideLeft", "eyeWideRight", "eyeWide"], eW.eyeWide);
        applyMorphSafe(child, ["eyeSquintLeft", "eyeSquintRight", "eyeSquint"], eW.eyeSquint);

        // Visemes
        applyMorphSafe(child, ["jawOpen", "mouthOpen"], combinedJaw);
        applyMorphSafe(child, ["mouthFunnel"], vW.mouthFunnel);
        applyMorphSafe(child, ["mouthPucker"], vW.mouthPucker);
        applyMorphSafe(child, ["mouthStretchLeft", "mouthStretchRight", "mouthStretch"], vW.mouthStretch);
        applyMorphSafe(child, ["mouthRollUpper"], vW.mouthRollUpper);
        applyMorphSafe(child, ["mouthRollLower"], vW.mouthRollLower);
        applyMorphSafe(child, ["mouthUpperUpLeft", "mouthUpperUpRight", "mouthUpperUp"], vW.mouthUpperUp);
        applyMorphSafe(child, ["tongueOut"], vW.tongueOut);
    });

    for (const jaw of jawBones) {
        jaw.rotation.x = THREE.MathUtils.lerp(jaw.rotation.x, combinedJaw * 0.45, Math.min(1, delta * 14));
    }
    
    // Emotion specific Head nodding/hanging
    for (const headBone of headBones) {
        let emotionTilt = 0;
        const emo = (currentEmotion || "neutral").toLowerCase();
        if (emo === 'sadness' || emo === 'sad') emotionTilt = 0.15; // hang head down
        else if (emo === 'joy' || emo === 'happy') emotionTilt = -0.05; // tilt up
        
        let nod = emotionTilt;
        if (forceSpeaking) {
            nod += combinedJaw * 0.04 + Math.sin(t * 3.2) * 0.008 + Math.sin(t * 6.0) * 0.03; // extra head nod while speaking
        }
        headBone.rotation.x = THREE.MathUtils.lerp(headBone.rotation.x, nod, Math.min(1, delta * 8));
        if (forceSpeaking) {
            headBone.rotation.y = THREE.MathUtils.lerp(headBone.rotation.y, Math.sin(t * 3.0) * 0.05, delta * 4);
            headBone.rotation.z = THREE.MathUtils.lerp(headBone.rotation.z, Math.cos(t * 4.0) * 0.02, delta * 4);
        } else {
            headBone.rotation.y = THREE.MathUtils.lerp(headBone.rotation.y, 0, delta * 4);
            headBone.rotation.z = THREE.MathUtils.lerp(headBone.rotation.z, 0, delta * 4);
        }
    }
}

window.updateAvatarEmotion = function (emotion) {
    currentEmotion = emotion || "neutral";
};

window.driveAvatarMouth = function (level) {
    speakingLevel = Math.max(0, Math.min(1, level || 0));
};

window.setAvatarSpeaking = function (isSpeaking) {
    forceSpeaking = !!isSpeaking;
};

window.setAvatarViseme = function (viseme, intensity) {
    activeViseme = viseme || "sil";
    visemeIntensity = Math.max(0, Math.min(1, intensity || 0));
};

window.addEventListener("resize", () => {
    if (!camera || !renderer) return;
    const container = document.getElementById("avatar-container");
    const width = Math.max(320, container.clientWidth || window.innerWidth);
    const height = Math.max(320, container.clientHeight || 500);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
});

initAvatar();
