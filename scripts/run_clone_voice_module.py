"""Run an external clone_voice.py module through a stable long-form CLI contract."""

from __future__ import annotations

import argparse
from array import array
import importlib.util
import json
import os
from pathlib import Path
import random
import re
import subprocess
import sys
import tempfile
from types import ModuleType
from typing import Callable
import wave


CloneVoice = Callable[[str, str, str, str], object]
SAMPLE_RATE = 24_000
SAMPLE_WIDTH = 2
CHANNELS = 1
EVENT_PREFIX = "VOICE_CLONE_EVENT="

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def env_int(name: str, default: int) -> int:
    value = os.environ.get(name, "").strip()
    if not value:
        return default
    try:
        return int(value)
    except ValueError as error:
        raise ValueError(f"{name} tam sayı olmalıdır: {value}") from error


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--text-file", required=True, type=Path)
    parser.add_argument("--speaker-wav", required=True, type=Path)
    parser.add_argument("--output-wav", required=True, type=Path)
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=env_int("VOICE_CLONE_CHUNK_SIZE", 220),
        help="Maximum characters per synthesis chunk (default: 220).",
    )
    parser.add_argument(
        "--pause-ms",
        type=int,
        default=env_int("VOICE_CLONE_CHUNK_PAUSE_MS", 180),
        help="Silence inserted between chunks (default: 180ms).",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=env_int("VOICE_CLONE_SEED", 0),
        help="Non-zero deterministic base seed; each chunk increments it.",
    )
    args = parser.parse_args()
    if args.chunk_size < 80 or args.chunk_size > 2_000:
        parser.error("--chunk-size 80 ile 2000 arasında olmalıdır.")
    if args.pause_ms < 0 or args.pause_ms > 2_000:
        parser.error("--pause-ms 0 ile 2000 arasında olmalıdır.")
    if args.seed < 0:
        parser.error("--seed negatif olamaz.")
    return args


def resolve_module_path() -> Path:
    configured_module = os.environ.get("VOICE_CLONE_MODULE", "").strip()
    if configured_module:
        return Path(configured_module).expanduser().resolve()

    workdir = os.environ.get("VOICE_CLONE_WORKDIR", "").strip()
    if not workdir:
        raise RuntimeError("VOICE_CLONE_MODULE veya VOICE_CLONE_WORKDIR yapılandırılmalıdır.")
    return (Path(workdir).expanduser() / "clone_voice.py").resolve()


def load_module(module_path: Path) -> ModuleType:
    if not module_path.is_file():
        raise FileNotFoundError(f"Ses klonlama modülü bulunamadı: {module_path}")
    spec = importlib.util.spec_from_file_location("external_clone_voice", module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Python modülü yüklenemedi: {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def get_clone_function(module: ModuleType) -> CloneVoice:
    clone_function = getattr(module, "clone_voice", None)
    if not callable(clone_function):
        raise TypeError("Modül callable clone_voice(text, speaker_wav, output_wav, language) içermiyor.")
    return clone_function


def normalize_text(text: str) -> str:
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.replace("\r", "\n").split("\n")]
    return "\n".join(line for line in lines if line)


def _hard_wrap(text: str, limit: int) -> list[str]:
    parts: list[str] = []
    current = ""
    for word in text.split():
        if len(word) > limit:
            if current:
                parts.append(current)
                current = ""
            parts.extend(word[index:index + limit] for index in range(0, len(word), limit))
        elif not current:
            current = word
        elif len(current) + 1 + len(word) <= limit:
            current = f"{current} {word}"
        else:
            parts.append(current)
            current = word
    if current:
        parts.append(current)
    return parts


def chunk_text(text: str, limit: int) -> list[str]:
    """Split at paragraph/sentence boundaries, then hard-wrap pathological sentences."""
    normalized = normalize_text(text)
    if not normalized:
        return []
    sentences = [
        segment.strip()
        for segment in re.split(r"(?<=[.!?…])\s+|\n+", normalized)
        if segment.strip()
    ]
    segments = [part for sentence in sentences for part in _hard_wrap(sentence, limit)]
    chunks: list[str] = []
    current = ""
    for segment in segments:
        candidate = segment if not current else f"{current} {segment}"
        if len(candidate) <= limit:
            current = candidate
        else:
            if current:
                chunks.append(current)
            current = segment
    if current:
        chunks.append(current)
    return chunks


def emit_progress(stage: str, current: int, total: int, message: str) -> None:
    percent = round((current / total) * 100) if total else 0
    event = {
        "stage": stage,
        "current": current,
        "total": total,
        "percent": percent,
        "message": message,
    }
    print(f"{EVENT_PREFIX}{json.dumps(event, ensure_ascii=False)}", flush=True)


def set_seed(seed: int) -> None:
    if seed == 0:
        return
    random.seed(seed)
    try:
        import numpy

        numpy.random.seed(seed)
    except ImportError:
        pass
    try:
        import torch

        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)
    except ImportError:
        pass


def normalize_audio(source: Path, destination: Path) -> None:
    if not source.is_file():
        raise FileNotFoundError(f"Ses dosyası bulunamadı: {source}")
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(source), "-ac", str(CHANNELS), "-ar", str(SAMPLE_RATE),
            "-c:a", "pcm_s16le", str(destination),
        ],
        check=True,
    )


def _apply_edge_fades(frames: bytes, fade_ms: int = 10) -> bytes:
    samples = array("h")
    samples.frombytes(frames)
    fade_samples = min(int(SAMPLE_RATE * fade_ms / 1_000), len(samples) // 2)
    for index in range(fade_samples):
        gain = index / fade_samples
        samples[index] = round(samples[index] * gain)
        samples[-index - 1] = round(samples[-index - 1] * gain)
    return samples.tobytes()


def stitch_wavs(chunk_paths: list[Path], output_path: Path, pause_ms: int) -> None:
    if not chunk_paths:
        raise ValueError("Birleştirilecek ses parçası yok.")
    silence_frames = int(SAMPLE_RATE * pause_ms / 1_000)
    silence = b"\x00" * silence_frames * SAMPLE_WIDTH * CHANNELS
    with wave.open(str(output_path), "wb") as destination:
        destination.setnchannels(CHANNELS)
        destination.setsampwidth(SAMPLE_WIDTH)
        destination.setframerate(SAMPLE_RATE)
        for index, chunk_path in enumerate(chunk_paths):
            with wave.open(str(chunk_path), "rb") as source:
                params = (source.getnchannels(), source.getsampwidth(), source.getframerate())
                if params != (CHANNELS, SAMPLE_WIDTH, SAMPLE_RATE):
                    raise ValueError(f"Beklenmeyen WAV formatı {params}: {chunk_path}")
                frames = _apply_edge_fades(source.readframes(source.getnframes()))
            if index:
                destination.writeframesraw(silence)
            destination.writeframesraw(frames)


def main() -> int:
    args = parse_args()
    text = args.text_file.read_text(encoding="utf-8").strip()
    chunks = chunk_text(text, args.chunk_size)
    if not chunks:
        raise ValueError("Türkçe metin dosyası boş.")

    output_path = args.output_wav.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    module = load_module(resolve_module_path())
    clone_voice = get_clone_function(module)
    emit_progress("preparing", 0, len(chunks), f"{len(chunks)} ses parçası hazırlandı.")

    with tempfile.TemporaryDirectory(prefix="voice-clone-", dir=output_path.parent) as temporary_dir:
        temporary_root = Path(temporary_dir)
        normalized_reference = temporary_root / "reference.wav"
        normalize_audio(args.speaker_wav.resolve(), normalized_reference)
        normalized_chunks: list[Path] = []

        for index, chunk in enumerate(chunks, start=1):
            raw_chunk = temporary_root / f"chunk-{index:04d}-raw.wav"
            normalized_chunk = temporary_root / f"chunk-{index:04d}.wav"
            set_seed(args.seed + index - 1 if args.seed else 0)
            emit_progress("synthesizing", index - 1, len(chunks), f"Parça {index}/{len(chunks)} üretiliyor.")
            clone_voice(chunk, str(normalized_reference), str(raw_chunk), "tr")
            normalize_audio(raw_chunk, normalized_chunk)
            normalized_chunks.append(normalized_chunk)
            emit_progress("synthesizing", index, len(chunks), f"Parça {index}/{len(chunks)} tamamlandı.")

        emit_progress("stitching", len(chunks), len(chunks), "Ses parçaları birleştiriliyor.")
        stitch_wavs(normalized_chunks, output_path, args.pause_ms)

    if not output_path.is_file() or output_path.stat().st_size <= 44:
        raise RuntimeError("clone_voice başarıyla döndü ancak geçerli WAV çıktısı oluşmadı.")
    emit_progress("completed", len(chunks), len(chunks), "WAV çıktısı hazır.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # Emit one actionable error for the Node job runner.
        print(f"voice-clone-adapter: {error}", file=sys.stderr, flush=True)
        raise SystemExit(1) from error
