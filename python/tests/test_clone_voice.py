from pathlib import Path
import importlib
import os
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch


PYTHON_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PYTHON_ROOT))

runtime = importlib.import_module("voice_clone.clone_voice")


class FakeModel:
    def __init__(self):
        self.device = None
        self.calls = []

    def to(self, device):
        self.device = device
        return self

    def tts_to_file(self, **kwargs):
        self.calls.append(kwargs)
        Path(kwargs["file_path"]).write_bytes(b"RIFF-test")


class CloneVoiceTests(unittest.TestCase):
    def setUp(self):
        runtime._model = None
        runtime._device = None
        runtime._model_name = None

    def fake_modules(self):
        fake_model = FakeModel()
        fake_tts_class = unittest.mock.Mock(return_value=fake_model)
        tts_package = ModuleType("TTS")
        tts_api = ModuleType("TTS.api")
        tts_api.TTS = fake_tts_class
        fake_cuda = SimpleNamespace(
            is_available=lambda: True,
            empty_cache=lambda: None,
        )
        fake_torch = SimpleNamespace(cuda=fake_cuda)
        return fake_model, fake_tts_class, {
            "TTS": tts_package,
            "TTS.api": tts_api,
            "torch": fake_torch,
        }

    def test_reuses_model_across_calls(self):
        fake_model, fake_tts_class, modules = self.fake_modules()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            speaker = root / "speaker.wav"
            speaker.write_bytes(b"RIFF-speaker")
            with patch.dict(sys.modules, modules), patch.dict(
                os.environ,
                {"COQUI_TOS_AGREED": "1", "VOICE_CLONE_DEVICE": "auto"},
                clear=False,
            ):
                runtime.clone_voice("Birinci metin", str(speaker), str(root / "one.wav"))
                runtime.clone_voice("İkinci metin", str(speaker), str(root / "two.wav"))

        fake_tts_class.assert_called_once_with(runtime.DEFAULT_MODEL)
        self.assertEqual(fake_model.device, "cuda")
        self.assertEqual(len(fake_model.calls), 2)

    def test_requires_explicit_terms_acceptance(self):
        _, _, modules = self.fake_modules()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            speaker = root / "speaker.wav"
            speaker.write_bytes(b"RIFF-speaker")
            with patch.dict(sys.modules, modules), patch.dict(os.environ, {}, clear=True):
                with self.assertRaisesRegex(RuntimeError, "kullanım koşulları"):
                    runtime.clone_voice("Test", str(speaker), str(root / "output.wav"))

    def test_validates_reference_before_loading_model(self):
        with self.assertRaises(FileNotFoundError):
            runtime.clone_voice("Test", "missing-reference.wav", "output.wav")


if __name__ == "__main__":
    unittest.main()
