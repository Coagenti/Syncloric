"""Offline deployment contract; runtime checks live in smoke.py."""
from pathlib import Path
import unittest
import os
import subprocess
import tempfile


class EntrypointTests(unittest.TestCase):
    def test_optional_base_url_normalization(self):
        with tempfile.TemporaryDirectory() as directory:
            node = Path(directory) / 'node'
            node.write_text('#!/bin/sh\nif [ "${NORISH_BASE_URL+x}" = x ]; then printf "set:%s" "$NORISH_BASE_URL"; else printf unset; fi\n')
            node.chmod(0o700)
            for value in [None, '', '   ', '\t\n', 'malformed-explicit-value']:
                with self.subTest(value=value):
                    env = {**os.environ, 'PATH': directory + os.pathsep + os.environ['PATH']}
                    env.pop('NORISH_BASE_URL', None)
                    if value is not None:
                        env['NORISH_BASE_URL'] = value
                    result = subprocess.run(['sh', str(ROOT / 'docker/entrypoint.sh')],
                                            env=env, capture_output=True, text=True, check=True)
                    self.assertEqual(result.stdout, 'set:' + value if value and value.strip() else 'unset')

    def test_optional_api_key_normalization(self):
        # Replace only the final node executable: exercise the real shell entrypoint.
        with tempfile.TemporaryDirectory() as directory:
            node = Path(directory) / 'node'
            node.write_text('#!/bin/sh\nif [ "${NORISH_API_KEY+x}" = x ]; then printf "set:%s" "$NORISH_API_KEY"; else printf unset; fi\n')
            node.chmod(0o700)
            for value in [None, '', 'fixture-only-api-key']:
                with self.subTest(value=value):
                    env = {**os.environ, 'PATH': directory + os.pathsep + os.environ['PATH']}
                    env.pop('NORISH_API_KEY', None)
                    if value is not None:
                        env['NORISH_API_KEY'] = value
                    result = subprocess.run(['sh', str(ROOT / 'docker/entrypoint.sh')],
                                            env=env, capture_output=True, text=True, check=True)
                    self.assertEqual(result.stdout, 'set:' + value if value else 'unset')

ROOT = Path(__file__).resolve().parents[2]


class PackagingTests(unittest.TestCase):
    def test_compose_upstream_is_optional_without_default(self):
        text = (ROOT / 'docker/docker-compose.yml').read_text()
        declarations = [line.strip() for line in text.splitlines() if line.strip().startswith('NORISH_BASE_URL:')]
        self.assertEqual(declarations, ['NORISH_BASE_URL: ${NORISH_BASE_URL-}'])
        for path in [ROOT / 'docker/.env.example', ROOT / 'docker/docker-compose.yml']:
            self.assertNotRegex(path.read_text(), r'https?://(?!127\.0\.0\.1:3000/api/health)[^\s]+')

    def test_deploy_template_is_hostless_and_minimal(self):
        path = ROOT / 'docker/.env.example'
        self.assertTrue(path.exists(), 'missing deployment template')
        text = path.read_text()
        self.assertIn('ADR-0007', text)
        self.assertEqual([line for line in text.splitlines() if line and not line.startswith('#')], ['NORISH_BASE_URL='])

    def test_build_context_excludes_local_environment(self):
        path = ROOT / '.dockerignore'
        self.assertTrue(path.exists(), 'missing build-context secret protection')
        rules = path.read_text().splitlines()
        for rule in ['**/.env', '**/.env.*', '**/node_modules', '**/.next', '.git', '**/secrets']:
            self.assertIn(rule, rules)


if __name__ == '__main__':
    unittest.main()
