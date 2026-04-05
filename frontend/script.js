let mediaRecorder;
let audioChunks = [];
let socket;

async function start() {

    // Disable start button to prevent multiple clicks
    document.querySelector("button").disabled = true;

    socket = new WebSocket("ws://127.0.0.1:8000/ws");

    socket.onopen = async function () {

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            mediaRecorder = new MediaRecorder(stream);

            mediaRecorder.start();

            console.log("Recording started");

            document.getElementById("stopBtn").disabled = false;

            mediaRecorder.ondataavailable = event => {
                if (event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            };

            mediaRecorder.onstop = () => {

                // ✅ Correct format (webm, not wav)
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });

                audioBlob.arrayBuffer().then(buffer => {

                    if (socket.readyState === WebSocket.OPEN) {
                        socket.send(buffer);
                    } else {
                        console.log("Socket not open ❌");
                    }

                });

                audioChunks = [];
            };

        } catch (err) {
            console.error("Mic access error:", err);
        }
    };

    socket.onmessage = function (event) {

        const data = JSON.parse(event.data);

        console.log("Emotion from backend:", data.emotion);

        // 📝 Display result
        document.getElementById("result").innerText =
            "Text: " + data.text +
            "\nLanguage: " + data.language +
            "\nEmotion: " + data.emotion;

        // 🎭 Update avatar emotion
        if (window.updateAvatarEmotion) {
            window.updateAvatarEmotion(data.emotion);
        }

        // 🔊 Play response audio
        const audio = new Audio("data:audio/mp3;base64," + data.audio);

        audio.play()
            .then(() => console.log("Audio playing ✅"))
            .catch(err => console.log("Audio play error ❌:", err));
    };

    socket.onerror = function (error) {
        console.log("WebSocket Error:", error);
    };

    socket.onclose = function () {
        console.log("WebSocket Closed");
    };
}

function stop() {

    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
        console.log("Recording stopped");
    }

    document.getElementById("stopBtn").disabled = true;

    // Re-enable start button
    document.querySelector("button").disabled = false;
}