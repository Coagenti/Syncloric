#!/usr/bin/env python3
"""Build release source assets from a Git commit, never the working tree."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def validate_files(files):
    """Reject unsafe runtime/lockfile bytes and CRLF in UTF-8 text assets."""
    for name in ['docker/entrypoint.sh', 'pnpm-lock.yaml']:
        if name not in files:
            raise ValueError(f'missing required asset: {name}')
    if not files['docker/entrypoint.sh'].startswith(b'#!/bin/sh\n'):
        raise ValueError('entrypoint must start with LF #!/bin/sh')
    for name, data in files.items():
        if b'\x00' in data:
            continue
        try:
            data.decode('utf-8')
        except UnicodeDecodeError:
            continue
        if b'\r\n' in data:
            raise ValueError(f'CRLF in release text asset: {name}')


def package(repo, ref, output):
    commit = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', '--verify', ref + '^{commit}'], text=True).strip()
    version = json.loads(subprocess.check_output(['git', '-C', str(repo), 'show', f'{commit}:package.json']))['version']
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?', version):
        raise ValueError('unsafe package version')
    stem = f'syncloric-{version}'
    raw_tar = subprocess.check_output(['git', '-C', str(repo), 'archive', '--format=tar', f'--prefix={stem}/', commit])
    with tarfile.open(fileobj=io.BytesIO(raw_tar)) as archive:
        files = {}
        for member in archive.getmembers():
            if member.isfile():
                stream = archive.extractfile(member)
                assert stream is not None
                files[member.name.removeprefix(stem + '/')] = stream.read()
    validate_files(files)
    raw_zip = subprocess.check_output(['git', '-C', str(repo), 'archive', '--format=zip', f'--prefix={stem}/', commit])
    with zipfile.ZipFile(io.BytesIO(raw_zip)) as archive:
        zip_files = {name.removeprefix(stem + '/'): archive.read(name) for name in archive.namelist() if not name.endswith('/')}
    if files != zip_files:
        raise ValueError('tar/zip file bytes differ')
    output.mkdir(parents=True, exist_ok=True)
    assets = {stem + '.tar.gz': gzip.compress(raw_tar, mtime=0), stem + '.zip': raw_zip}
    checksums = []
    for name, data in assets.items():
        (output / name).write_bytes(data)
        checksums.append(f'{hashlib.sha256(data).hexdigest()}  {name}\n')
    (output / 'SHA256SUMS.txt').write_bytes(''.join(checksums).encode('ascii'))
    print(f'Packaged {commit}: {len(files)} files, LF validated in tar and zip; output={output}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=ROOT)
    parser.add_argument('--ref', default='HEAD')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    package(args.repo, args.ref, args.output)


if __name__ == '__main__':
    main()
