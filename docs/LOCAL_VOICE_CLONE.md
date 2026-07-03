# Local Voice Clone Setup

AudioTransTurk keeps Gemini translation on the Node backend and delegates voice cloning to an existing local Python module. The repository does not contain or duplicate the Coqui XTTS model implementation.

## Windows configuration

Copy `.env.example` to `.env`, then use absolute Windows paths:

```dotenv
GEMINI_API_KEY=your-key
VOICE_CLONE_PYTHON_EXE=C:\Users\YeniKullanici\ses-clon-öykü\.venv\Scripts\python.exe
VOICE_CLONE_SCRIPT=scripts/run_clone_voice_module.py
VOICE_CLONE_WORKDIR=C:\Users\YeniKullanici\ses-clon-öykü
VOICE_CLONE_MODULE=C:\Users\YeniKullanici\ses-clon-öykü\clone_voice.py
DATA_DIR=data
PORT=3000
```

`VOICE_CLONE_MODULE` may be empty when `clone_voice.py` is directly inside `VOICE_CLONE_WORKDIR`. Relative `VOICE_CLONE_SCRIPT` and `DATA_DIR` values resolve from the AudioTransTurk repository root.

## Python module contract

The external module must expose this callable:

```python
def clone_voice(text, speaker_wav, output_wav="output.wav", language="tr"):
    ...
```

The adapter imports the module dynamically, converts the uploaded reference to mono 24 kHz PCM WAV with ffmpeg, and invokes:

```python
clone_voice(text, normalized_reference, output_wav, "tr")
```

Install Python/Coqui/Torch dependencies only in the prototype virtual environment. XTTS model weights remain outside this repository and may download on first use.

## Runtime flow

1. The browser uploads Russian media to `POST /api/gemini/jobs`.
2. Node uploads it to the Gemini Files API, polls until ready, and stores Russian/Turkish text under `DATA_DIR/outputs/<jobId>`.
3. The browser sends Turkish text and the reference audio to `POST /api/local-voice/clone`.
4. A single-worker FIFO queue starts the configured Python interpreter and adapter.
5. The browser polls the job and plays `cloned_turkish.wav` when complete.

Job state is persisted in `job.json`. On server restart, incomplete jobs are marked failed. Successful source uploads are deleted; output text, WAV, and metadata remain. Failed uploads remain for diagnosis.

## Prerequisites and checks

```powershell
ffmpeg -version
C:\Users\YeniKullanici\ses-clon-öykü\.venv\Scripts\python.exe C:\Users\YeniKullanici\ses-clon-öykü\test_setup.py
npm install
npm run lint
npm run build
npm run dev
Invoke-RestMethod http://localhost:3000/api/health | ConvertTo-Json -Depth 5
```

The health response must report `geminiConfigured`, `scriptConfigured`, `pythonAvailable`, `moduleConfigured`, and `ffmpegAvailable` as `true`. CPU-only XTTS can be slow; verify the complete flow with short media and a clean 30–90 second single-speaker reference before using long files.

Runtime files, media, `.env`, API keys, and model files must not be committed.
