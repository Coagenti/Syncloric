"""Offline deployment contract; runtime checks live in smoke.py."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class PackagingTests(unittest.TestCase):
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
