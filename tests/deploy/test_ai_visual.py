"""Offline subprocess regression for visual fixture cleanup."""
from pathlib import Path
import os
import signal
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]


class AiVisualCleanupTests(unittest.TestCase):
    def test_invalid_output_directory_exits_without_leaking_server(self):
        with tempfile.TemporaryDirectory(dir=ROOT, prefix='.ai-visual-test-') as directory:
            env = {
                **os.environ,
                'AI_VISUAL_OUTPUT': str(Path(__file__).resolve()),
                'TMPDIR': directory,
            }
            with subprocess.Popen(
                ['node', 'tests/e2e/ai-visual.mjs'],
                cwd=ROOT,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                start_new_session=True,
            ) as process:
                try:
                    stdout, stderr = process.communicate(timeout=30)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    stdout, stderr = process.communicate()
                    self.fail(f'Visual script did not exit within 30 seconds:\n{stdout}{stderr}')
                self.assertNotEqual(process.returncode, 0, stdout + stderr)
                self.assertIn('EEXIST', stderr)


if __name__ == '__main__':
    unittest.main()
