import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.module.js';

import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/loaders/GLTFLoader.js';
console.log("avatar.js loaded");

let scene, camera, renderer, avatar;

function initAvatar() {

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222);

    // Camera
    camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / 500,
        0.1,
        1000
    );
    camera.position.set(0, 1, 5);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, 500);
    renderer.setPixelRatio(window.devicePixelRatio); // ✅ better quality

    document.getElementById("avatar-container").appendChild(renderer.domElement);

    // Lights
    const dirLight = new THREE.DirectionalLight(0xffffff, 2);
    dirLight.position.set(2, 2, 5);
    scene.add(dirLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1);
    scene.add(ambientLight);

    // Loader
    const loader = new GLTFLoader();

    loader.load(
        "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Fox/glTF-Binary/Fox.glb",
        (gltf) => {

            console.log("✅ Avatar loaded");

            avatar = gltf.scene;
            window.avatarModel = avatar;

            avatar.scale.set(20, 20, 20);
            avatar.position.set(-1, -2, 0);

            scene.add(avatar);

            // Debug morph targets
            avatar.traverse((child) => {
                if (child.morphTargetDictionary) {
                    console.log("🎯 Morph Targets Found:");
                    console.log(child.morphTargetDictionary);
                }
            });
        },

        (xhr) => {
            // ✅ loading progress
            console.log(`Loading: ${(xhr.loaded / xhr.total * 100).toFixed(2)}%`);
        },

        (error) => {
            console.error("❌ Error loading avatar:", error);
        }
    );

    animate();
}

function animate() {
    requestAnimationFrame(animate);

    if (avatar) {
        avatar.rotation.y += 0.005; // smoother rotation
    }

    renderer.render(scene, camera);
}

initAvatar();


// 🎭 Emotion Control (IMPROVED)
window.updateAvatarEmotion = function (emotion) {

    if (!window.avatarModel) return;

    window.avatarModel.traverse((child) => {

        if (child.morphTargetDictionary && child.morphTargetInfluences) {

            const dict = child.morphTargetDictionary;
            const influences = child.morphTargetInfluences;

            // Reset all
            for (let i = 0; i < influences.length; i++) {
                influences[i] = 0;
            }

            // Smooth mapping (better realism)
            if (emotion === "joy") {
                if (dict["Smile"] !== undefined) {
                    influences[dict["Smile"]] = 0.8;
                }
            }

            if (emotion === "sadness") {
                if (dict["Sad"] !== undefined) {
                    influences[dict["Sad"]] = 0.9;
                }
            }

            if (emotion === "anger") {
                if (dict["Angry"] !== undefined) {
                    influences[dict["Angry"]] = 1;
                }
            }

            if (emotion === "surprise") {
                if (dict["Surprised"] !== undefined) {
                    influences[dict["Surprised"]] = 1;
                }
            }
        }
    });
};


// ✅ Handle window resize (important)
window.addEventListener("resize", () => {

    camera.aspect = window.innerWidth / 500;
    camera.updateProjectionMatrix();

    renderer.setSize(window.innerWidth, 500);
});