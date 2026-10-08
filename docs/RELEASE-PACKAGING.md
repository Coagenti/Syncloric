# Release source packaging

Source tar.gz and zip assets must be built from committed Git blobs, never by
compressing a working directory. A Windows checkout with CRLF broke the original
v0.1.0 Docker entrypoint (`#!/bin/sh\r` produces ENOENT on Linux). Checksums prove
integrity, not deployability.

## Build and verify

From the repository with Python 3 and Git installed:

```sh
python3 tests/deploy/test_packaging.py
python3 tests/deploy/test_release_archives.py
python3 scripts/package-release.py --ref v0.1.0 --output ../release-assets
(cd ../release-assets && sha256sum -c SHA256SUMS.txt)
```

Use an approved commit/tag for `--ref`; HEAD packages the committed state and
intentionally excludes uncommitted changes, untracked files and local `.env`.
The version/prefix comes from package.json at that commit. No tag or release is
modified by this script. The script generates both formats with `git archive`,
checks required entrypoint/lockfile bytes, rejects CRLF in UTF-8 text files,
compares tar/zip payloads and writes LF SHA256SUMS.txt. It fails rather than
silently rewriting bad committed blobs. Binary data is not normalized.

`.gitattributes` enforces LF even with core.autocrlf=true; after adding it,
`git add --renormalize .` audits/normalizes already tracked text. Existing LF
blobs should produce no unrelated tree changes.

CI exercises both archive formats and the Windows-style checkout regression,
then builds and runs Docker/PostgreSQL smoke from the generated tarball, not
from checkout files. Verified source assets are retained as CI artifacts.

## Publication gate

After PR review, required exact-head CI and merge by the Technical Lead, rebuild
from the approved tag/commit and smoke the downloaded candidate assets on a
non-production Docker host. Publication/replacement of v0.1.0 versus a new patch
release is a Technical Lead decision. Do not move an existing tag or overwrite
published assets implicitly. If replacing v0.1.0, publish both archives and the
new SHA256SUMS.txt together, document the changed hashes in release notes and
verify by downloading the published assets again. Old cached assets remain bad.

AI contribution: packaging implementation, regression tests and this document
were generated with AI assistance. Human contribution: Technical Lead approval,
review, merge and release authorization must be recorded at publication; not
claimed as already performed.
