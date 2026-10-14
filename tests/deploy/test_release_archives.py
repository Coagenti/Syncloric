"""Exercise release packaging from blobs, not normalized text readers."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]


class ReleaseArchiveTests(unittest.TestCase):
    def test_archives_ignore_crlf_worktree_and_preserve_blob_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory) / 'repo'
            repo.mkdir()
            subprocess.run(['git', 'init', '--quiet', str(repo)], check=True)
            subprocess.run(['git', '-C', str(repo), 'config', 'core.autocrlf', 'false'], check=True)
            files = {
                'package.json': json.dumps({'version': '0.1.0'}).encode() + b'\n',
                'pnpm-lock.yaml': b'lockfileVersion: 9\n',
                'docker/entrypoint.sh': b'#!/bin/sh\nexec node /app/server.js\n',
            }
            for name, data in files.items():
                path = repo / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
            subprocess.run(['git', '-C', str(repo), 'add', '.'], check=True)
            subprocess.run(['git', '-C', str(repo), '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture'], check=True)
            # Reproduce Windows Git conversion on Linux CI as well.
            subprocess.run(['git', '-C', str(repo), 'config', 'core.autocrlf', 'true'], check=True)
            subprocess.run(['git', '-C', str(repo), 'config', 'core.eol', 'crlf'], check=True)
            # Simulate the faulty Windows packaging tree, including an untracked secret.
            for name, data in files.items():
                (repo / name).write_bytes(data.replace(b'\n', b'\r\n'))
            (repo / '.env').write_text('UNTRACKED=never-package\n')
            output = Path(directory) / 'release'
            result = subprocess.run([sys.executable, str(ROOT / 'scripts/package-release.py'), '--repo', str(repo), '--ref', 'HEAD', '--output', str(output)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            with tarfile.open(output / 'syncloric-0.1.0.tar.gz') as archive:
                tar_files = {m.name: archive.extractfile(m).read() for m in archive.getmembers() if m.isfile()}
            with zipfile.ZipFile(output / 'syncloric-0.1.0.zip') as archive:
                zip_files = {name: archive.read(name) for name in archive.namelist() if not name.endswith('/')}
            self.assertEqual(tar_files, zip_files)
            self.assertEqual(tar_files, {'syncloric-0.1.0/' + name: data for name, data in files.items()})
            for line in (output / 'SHA256SUMS.txt').read_text().splitlines():
                digest, name = line.split('  ')
                self.assertEqual(digest, hashlib.sha256((output / name).read_bytes()).hexdigest())

    def test_rejects_committed_crlf_instead_of_repairing_it(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory) / 'repo'
            repo.mkdir()
            subprocess.run(['git', 'init', '--quiet', str(repo)], check=True)
            subprocess.run(['git', '-C', str(repo), 'config', 'core.autocrlf', 'false'], check=True)
            (repo / 'docker').mkdir()
            (repo / 'package.json').write_bytes(b'{"version":"0.2.0"}\n')
            (repo / 'pnpm-lock.yaml').write_bytes(b'lockfileVersion: 9\n')
            (repo / 'docker/entrypoint.sh').write_bytes(b'#!/bin/sh\r\nexec node /app/server.js\r\n')
            subprocess.run(['git', '-C', str(repo), 'add', '.'], check=True)
            subprocess.run(['git', '-C', str(repo), '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'invalid fixture'], check=True)
            result = subprocess.run([sys.executable, str(ROOT / 'scripts/package-release.py'), '--repo', str(repo), '--ref', 'HEAD', '--output', str(Path(directory) / 'release')], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('entrypoint must start with LF', result.stderr)


if __name__ == '__main__':
    unittest.main()
