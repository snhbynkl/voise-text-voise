"""Lazy-loaded Coqui XTTS implementation used by the Node adapter."""

from __future__ import annotations

import gc
import os
from pathlib import Path
import threading
import time
from typing import Any


DEFAULT_MODEL = "tts_models/multilingual/multi-dataset/xtts_v2"
SUPPORTED_DEVICES = {"auto", "cpu", "cuda"}

_model: Any | None = None
_device: str | None = None
_model_name: str | None = None
_model_lock = threading.Lock()


def _selected_device(torch_module: Any) -> str:
    requested = os.environ.get("VOICE_CLONE_DEVICE", "auto").strip().lower() or "auto"
    if requested not in SUPPORTED_DEVICES:
        raise ValueError(
            f"VOICE_CLONE_DEVICE şu değerlerden biri olmalıdır: {sorted(SUPPORTED_DEVICES)}"
        )
    if requested == "auto":
        return "cuda" if torch_module.cuda.is_available() else "cpu"
    if requested == "cuda" and not torch_module.cuda.is_available():
        raise RuntimeError("VOICE_CLONE_DEVICE=cuda seçildi ancak CUDA kullanılamıyor.")
    return requested


def _load_model() -> Any:
    global _model, _device, _model_name
    model_name = os.environ.get("VOICE_CLONE_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL

    with _model_lock:
        if _model is not None:
            if model_name != _model_name:
                raise RuntimeError(
                    "Model bir proses içinde değiştirilemez; yeni model için yeni job başlatın."
                )
            print(f"Reusing cached XTTS model on {_device}", flush=True)
            return _model

        if os.environ.get("COQUI_TOS_AGREED", "").strip() != "1":
            raise RuntimeError(
                "Coqui kullanım koşulları kabul edilmedi. İnceledikten sonra "
                "COQUI_TOS_AGREED=1 ayarlayın."
            )

        try:
            import torch
            from TTS.api import TTS
        except ImportError as error:
            raise RuntimeError(
                "Coqui XTTS bağımlılıkları eksik. scripts/setup_voice_clone.ps1 çalıştırın."
            ) from error

        _device = _selected_device(torch)
        _model_name = model_name
        print(f"Loading {model_name} on {_device}...", flush=True)
        started_at = time.monotonic()
        _model = TTS(model_name).to(_device)
        print(f"Model loaded in {time.monotonic() - started_at:.2f} seconds.", flush=True)
        return _model


def clone_voice(
    text: str,
    speaker_wav: str,
    output_wav: str = "output.wav",
    language: str = "tr",
) -> None:
    """Generate speech using the stable adapter contract."""
    normalized_text = text.strip()
    if not normalized_text:
        raise ValueError("Seslendirilecek metin boş olamaz.")

    speaker_path = Path(speaker_wav).expanduser().resolve()
    if not speaker_path.is_file():
        raise FileNotFoundError(f"Referans ses bulunamadı: {speaker_path}")

    output_path = Path(output_wav).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    model = _load_model()
    started_at = time.monotonic()
    model.tts_to_file(
        text=normalized_text,
        speaker_wav=str(speaker_path),
        language=language,
        file_path=str(output_path),
    )
    if not output_path.is_file():
        raise RuntimeError("XTTS tamamlandı ancak çıktı dosyası oluşmadı.")
    print(
        f"Audio generated in {time.monotonic() - started_at:.2f} seconds: {output_path}",
        flush=True,
    )


def unload_model() -> None:
    """Release cached model resources; mainly useful for diagnostics and tests."""
    global _model, _device, _model_name
    with _model_lock:
        _model = None
        _device = None
        _model_name = None
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except ImportError:
        pass
