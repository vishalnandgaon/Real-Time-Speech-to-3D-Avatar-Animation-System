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

    // attach to avatar container
    document.getElementById("avatar-container").appendChild(renderer.domElement);

    // Lights
    const dirLight = new THREE.DirectionalLight(0xffffff, 2);
    dirLight.position.set(2, 2, 5);
    scene.add(dirLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1);
    scene.add(ambientLight);

    // Load avatar
    const loader = new THREE.GLTFLoader();

    loader.load(
        "avatar.glb",
        function (gltf) {

            console.log("Avatar loaded");

            avatar = gltf.scene;

            avatar.scale.set(1, 1, 1);
            avatar.position.set(0, -1, 0);

            scene.add(avatar);

        },
        undefined,
        function (error) {
            console.error("Error loading avatar:", error);
        }
    );

    animate();
}

function animate() {

    requestAnimationFrame(animate);

    if (avatar) {
        avatar.rotation.y += 0.01;
    }

    renderer.render(scene, camera);
}

initAvatar();