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

ROOT = Path(__file__).resolve().parents[2]


class PackagingTests(unittest.TestCase):
    def test_windows_style_checkout_preserves_runtime_and_lockfile_lf(self):
        with tempfile.TemporaryDirectory() as directory:
            subprocess.run(['git', 'clone', '--quiet', '--no-checkout', str(ROOT), directory], check=True)
            subprocess.run(['git', '-C', directory, 'config', 'core.autocrlf', 'true'], check=True)
            # Test committed attributes during the first checkout, as on CI.
            # Prewriting a tracked .gitattributes would block Git's checkout.
            subprocess.run(['git', '-C', directory, 'checkout', '--quiet', 'HEAD'], check=True)
            for name in ['docker/entrypoint.sh', 'pnpm-lock.yaml', 'docker/Dockerfile', 'docker/docker-compose.yml']:
                with self.subTest(path=name):
                    self.assertNotIn(b'\r\n', (Path(directory) / name).read_bytes())

    def test_compose_does_not_supply_a_shared_norish_key(self):
        text = (ROOT / 'docker/docker-compose.yml').read_text()
        self.assertNotIn('NORISH_API_KEY:', text)

    def test_compose_passes_public_origin_and_upstream_timezone_once_without_defaults(self):
        text = (ROOT / 'docker/docker-compose.yml').read_text()
        for name in ['BETTER_AUTH_URL', 'NORISH_UPSTREAM_TZ']:
            declarations = [line.strip() for line in text.splitlines() if line.strip().startswith(f'{name}:')]
            self.assertEqual(declarations, [f'{name}: ${{{name}-}}'])

    def test_compose_passes_optional_ai_environment_without_secrets_or_provider_default(self):
        text = (ROOT / 'docker/docker-compose.yml').read_text()
        for name in ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OLLAMA_BASE_URL', 'SYNCLORIC_AI_MODEL']:
            self.assertIn(f'{name}: ${{{name}-}}', text)
        self.assertNotIn('AI_PROVIDER:', text)

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
        # Preserve both deployment settings: upstream TZ and public app origin.
        self.assertEqual(
            [line for line in text.splitlines() if line and not line.startswith('#')],
            ['NORISH_BASE_URL=', 'NORISH_UPSTREAM_TZ=', 'BETTER_AUTH_URL='],
        )

    def test_build_context_excludes_local_environment(self):
        path = ROOT / '.dockerignore'
        self.assertTrue(path.exists(), 'missing build-context secret protection')
        rules = path.read_text().splitlines()
        for rule in ['**/.env', '**/.env.*', '**/node_modules', '**/.next', '.git', '**/secrets']:
            self.assertIn(rule, rules)


if __name__ == '__main__':
    unittest.main()
