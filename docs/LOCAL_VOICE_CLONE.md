# Integrated Local Voice Clone Runtime

AudioTransTurk contains its Python integration under `python/voice_clone/`. The repository tracks the lazy-loaded XTTS wrapper and its dependency manifest, but never model weights, virtual environments, reference media, or generated audio.

## Windows quick start

Requirements: Python 3.11, Node.js, and `ffmpeg` on `PATH`.
If `uv` is installed, the setup script uses it for faster deterministic dependency resolution; otherwise it falls back to `pip`.

```powershell
cd C:\Users\YeniKullanici\projects\voise-text-voise

# NVIDIA CUDA 12.4 (RTX 40-series)
.\scripts\setup_voice_clone.ps1 -Device cuda

# Or CPU-only
# .\scripts\setup_voice_clone.ps1 -Device cpu

Copy-Item .env.example .env
notepad .env
npm install
npm run dev
```

Set `GEMINI_API_KEY` in `.env`. Review the Coqui model terms yourself; only then set `COQUI_TOS_AGREED=1`. The application intentionally does not accept third-party terms on the user's behalf.

Default repo-contained configuration:

```dotenv
VOICE_CLONE_PYTHON_EXE=.venv/Scripts/python.exe
VOICE_CLONE_SCRIPT=scripts/run_clone_voice_module.py
VOICE_CLONE_WORKDIR=python/voice_clone
VOICE_CLONE_MODULE=
VOICE_CLONE_DEVICE=auto
VOICE_CLONE_MODEL=tts_models/multilingual/multi-dataset/xtts_v2
VOICE_CLONE_CHUNK_SIZE=220
VOICE_CLONE_CHUNK_PAUSE_MS=180
VOICE_CLONE_SEED=0
COQUI_TOS_AGREED=1
```

`VOICE_CLONE_MODULE` may stay empty because `clone_voice.py` is inside `VOICE_CLONE_WORKDIR`. Absolute external module paths remain supported for custom engines.

On Linux/macOS, create `.venv` manually and use `.venv/bin/python` for `VOICE_CLONE_PYTHON_EXE`. Install the appropriate Torch build first, followed by `pip install -r python/requirements.txt`.

## Runtime design

The integrated module preserves the stable adapter contract:

```python
def clone_voice(text, speaker_wav, output_wav="output.wav", language="tr"):
    ...
```

- Coqui and Torch import lazily, so lint, tests, and server startup do not load the model.
- The model is cached once per adapter process and reused for every long-form chunk.
- `VOICE_CLONE_DEVICE=auto` selects CUDA when available and otherwise uses CPU.
- Reference files and output paths are validated before inference.
- The model cache is released when the adapter process exits; model weights remain in the standard external Hugging Face/Coqui cache.

The adapter uses a deterministic long-form pipeline inspired by the MIT-licensed [Chatterbox TTS Server](https://github.com/devnen/Chatterbox-TTS-Server): sentence-aware chunking, per-chunk progress, 24 kHz mono normalization, edge fades, configurable pauses, and optional deterministic seeds. No Chatterbox engine/model code is embedded.

## Runtime flow

1. The browser uploads Russian media to the backend Gemini job API.
2. Gemini returns Russian transcription and Turkish translation.
3. The browser submits Turkish text and reference audio to the local voice job API.
4. The FIFO worker launches the repo `.venv`, adapter, and integrated XTTS module.
5. Chunk progress is persisted in `DATA_DIR/outputs/<jobId>/job.json` and displayed in the UI.
6. The final `cloned_turkish.wav` is available for playback and download.

Successful source uploads are deleted. Outputs and metadata remain. Interrupted jobs become `failed` after restart.

## Diagnostics and verification

```powershell
ffmpeg -version
.\.venv\Scripts\python.exe python\voice_clone\diagnostics.py
npm test
npm run lint
npm run build
npm run dev
Invoke-RestMethod http://localhost:3000/api/health | ConvertTo-Json -Depth 6
```

Health must report `pythonAvailable`, `scriptConfigured`, `moduleConfigured`, `ffmpegAvailable`, and `coquiTermsAccepted` as `true`. Start with short media and a clean 30–90 second single-speaker reference.
