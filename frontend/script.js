let mediaRecorder;
let audioChunks = [];
let socket;

async function start() {

    // 🔓 Unlock audio autoplay
    document.body.addEventListener('click', () => {
        const dummyAudio = new Audio();
        dummyAudio.play().catch(() => {});
    }, { once: true });

    socket = new WebSocket("ws://127.0.0.1:8000/ws");

    socket.onopen = async function() {

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        mediaRecorder = new MediaRecorder(stream);

        mediaRecorder.start();

        console.log("Recording started");

        document.getElementById("stopBtn").disabled = false;

        mediaRecorder.ondataavailable = event => {
            audioChunks.push(event.data);
        };

        mediaRecorder.onstop = () => {

            const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });

            audioBlob.arrayBuffer().then(buffer => {
                socket.send(buffer);
            });

            audioChunks = [];
        };
    };

    socket.onmessage = function(event) {

    const data = JSON.parse(event.data);

    // 📝 Show text
    document.getElementById("result").innerText =
        "Text: " + data.text +
        "\nLanguage: " + data.language +
        "\nEmotion: " + data.emotion;

    // 🔊 Play audio
    const audio = new Audio("data:audio/mp3;base64," + data.audio);

    audio.play().then(() => {
        console.log("Audio playing ✅");
    }).catch(err => {
        console.log("Audio play error ❌:", err);
    });
};

    socket.onerror = function(error) {
        console.log("WebSocket Error:", error);
    };

    socket.onclose = function() {
        console.log("WebSocket Closed");
    };
}

function stop() {

    if (mediaRecorder) {
        mediaRecorder.stop();
        console.log("Recording stopped");
    }

    document.getElementById("stopBtn").disabled = true;
}