"""Run an external clone_voice.py module through a stable command-line contract."""

from __future__ import annotations

import argparse
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import ModuleType
from typing import Callable


CloneVoice = Callable[[str, str, str, str], object]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--text-file", required=True, type=Path)
    parser.add_argument("--speaker-wav", required=True, type=Path)
    parser.add_argument("--output-wav", required=True, type=Path)
    return parser.parse_args()


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


def normalize_reference(source: Path, destination: Path) -> None:
    if not source.is_file():
        raise FileNotFoundError(f"Referans ses bulunamadı: {source}")
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source),
            "-ac",
            "1",
            "-ar",
            "24000",
            "-c:a",
            "pcm_s16le",
            str(destination),
        ],
        check=True,
    )


def main() -> int:
    args = parse_args()
    text = args.text_file.read_text(encoding="utf-8").strip()
    if not text:
        raise ValueError("Türkçe metin dosyası boş.")

    output_path = args.output_wav.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    module = load_module(resolve_module_path())
    clone_voice = get_clone_function(module)

    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix="voice-reference-",
            suffix=".wav",
            dir=output_path.parent,
            delete=False,
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
        normalize_reference(args.speaker_wav.resolve(), temporary_path)
        clone_voice(text, str(temporary_path), str(output_path), "tr")
        if not output_path.is_file():
            raise RuntimeError("clone_voice başarıyla döndü ancak WAV çıktısı oluşmadı.")
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # Emit one actionable error for the Node job runner.
        print(f"voice-clone-adapter: {error}", file=sys.stderr)
        raise SystemExit(1) from error
