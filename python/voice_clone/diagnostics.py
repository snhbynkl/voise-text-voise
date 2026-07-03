"""Print machine-readable diagnostics for the integrated XTTS runtime."""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version
import json
import os
import platform
import shutil
import sys


def package_version(name: str) -> str | None:
    try:
        return version(name)
    except PackageNotFoundError:
        return None


def collect_diagnostics() -> dict[str, object]:
    torch_version = package_version("torch")
    cuda_available = False
    gpu_name = None
    if torch_version:
        import torch

        cuda_available = torch.cuda.is_available()
        if cuda_available:
            gpu_name = torch.cuda.get_device_name(0)

    return {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "packages": {
            "coqui-tts": package_version("coqui-tts"),
            "torch": torch_version,
            "torchaudio": package_version("torchaudio"),
        },
        "cudaAvailable": cuda_available,
        "gpuName": gpu_name,
        "ffmpegAvailable": shutil.which("ffmpeg") is not None,
        "coquiTermsAccepted": os.environ.get("COQUI_TOS_AGREED", "").strip() == "1",
    }


if __name__ == "__main__":
    print(json.dumps(collect_diagnostics(), ensure_ascii=False, indent=2))
