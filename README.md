---
title: Real Time Speech To 3D Avatar
emoji: 🗣️
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
---

# Real-Time Speech-to-3D Avatar Animation System

A real-time interactive system that animates a 3D avatar based on user speech. The system performs speech-to-text, detects emotions, and translates speech to English, all while synchronizing the avatar's lip movements and facial expressions.

## Features
- **Real-Time Speech-to-Text**: Powered by OpenAI Whisper.
- **Emotion Detection**: Analyzes sentiment to trigger avatar expressions (Happy, Sad, Angry, etc.).
- **3D Avatar Animation**: High-fidelity Three.js avatar with dynamic blendshapes and lip-sync.
- **Auto-Translation**: Automatically converts multilingual speech to English transcripts.

## Technology Stack
- **Backend**: FastAPI (Python), OpenAI Whisper, Transformers (DistilRoBERTa).
- **Frontend**: HTML5, Vanilla CSS, JavaScript (Three.js).
- **Deployment**: Docker, Hugging Face Spaces.

## Local Setup
1. Clone the repository.
2. Install dependencies:
   ```bash
   pip install -r backend/requirements.txt
