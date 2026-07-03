# AudioTransTurk

Local-first Russian-to-Turkish media localization with Gemini transcription/translation and repository-contained Coqui XTTS voice cloning.

## Features

- Server-side Gemini media processing; API keys are not bundled into the browser.
- Turkish voice cloning from a user-provided reference recording.
- Sentence-aware long-form chunking, progress reporting, deterministic seeds, and stitched 24 kHz WAV output.
- Persistent background job metadata and a single-worker queue for predictable GPU usage.
- Integrated Python runtime, Windows setup automation, tests, and GitHub Actions CI.

## Windows quick start

```powershell
git clone https://github.com/snhbynkl/voise-text-voise.git
cd voise-text-voise
.\scripts\setup_voice_clone.ps1 -Device cuda
Copy-Item .env.example .env
notepad .env
npm install
npm run dev
```

Add `GEMINI_API_KEY` to `.env`. Review the Coqui terms before setting `COQUI_TOS_AGREED=1`.

Open `http://localhost:3000`. See [Local Voice Clone Setup](docs/LOCAL_VOICE_CLONE.md) for CPU installation, configuration, diagnostics, and runtime details.
