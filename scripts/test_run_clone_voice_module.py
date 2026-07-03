import contextlib
import io
from pathlib import Path
import tempfile
import unittest
import wave

import run_clone_voice_module as adapter


class ChunkTextTests(unittest.TestCase):
    def test_preserves_sentence_boundaries_within_limit(self):
        text = "Birinci kısa cümle. İkinci kısa cümle! Üçüncü cümle burada."

        chunks = adapter.chunk_text(text, 40)

        self.assertEqual(chunks, ["Birinci kısa cümle. İkinci kısa cümle!", "Üçüncü cümle burada."])
        self.assertTrue(all(len(chunk) <= 40 for chunk in chunks))

    def test_hard_wraps_long_sentence_and_word(self):
        text = f"{'kelime ' * 20}{'x' * 100}"

        chunks = adapter.chunk_text(text, 80)

        self.assertGreater(len(chunks), 2)
        self.assertTrue(all(0 < len(chunk) <= 80 for chunk in chunks))

    def test_normalizes_whitespace_and_empty_lines(self):
        self.assertEqual(
            adapter.normalize_text("  Merhaba   dünya.\r\n\r\n Yeni satır. "),
            "Merhaba dünya.\nYeni satır.",
        )


class WavStitchTests(unittest.TestCase):
    def _write_wav(self, path: Path, frame_count: int, sample: int) -> None:
        frames = int(sample).to_bytes(2, "little", signed=True) * frame_count
        with wave.open(str(path), "wb") as output:
            output.setnchannels(adapter.CHANNELS)
            output.setsampwidth(adapter.SAMPLE_WIDTH)
            output.setframerate(adapter.SAMPLE_RATE)
            output.writeframes(frames)

    def test_stitches_pcm_chunks_with_requested_pause(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = root / "first.wav"
            second = root / "second.wav"
            output = root / "output.wav"
            self._write_wav(first, 2_400, 1_000)
            self._write_wav(second, 4_800, -1_000)

            adapter.stitch_wavs([first, second], output, pause_ms=100)

            with wave.open(str(output), "rb") as result:
                self.assertEqual(result.getframerate(), adapter.SAMPLE_RATE)
                self.assertEqual(result.getnchannels(), adapter.CHANNELS)
                self.assertEqual(result.getsampwidth(), adapter.SAMPLE_WIDTH)
                self.assertEqual(result.getnframes(), 2_400 + 2_400 + 4_800)

    def test_progress_event_is_machine_readable(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            adapter.emit_progress("synthesizing", 1, 4, "Parça tamamlandı.")

        line = output.getvalue().strip()
        self.assertTrue(line.startswith(adapter.EVENT_PREFIX))
        self.assertIn('"percent": 25', line)


if __name__ == "__main__":
    unittest.main()
