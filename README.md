# Real-Time Speech-to-3D Avatar Animation System
This is a mini project created by us, just for fun.

## Run

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Open:

```text
http://127.0.0.1:8000/app/
```

Use `WHISPER_MODEL=small`, `medium`, or `large` before the command if you want a stronger transcription model than the default `base`.
