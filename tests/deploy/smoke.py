"""Real Docker/Compose smoke. Only disposable CI projects; never production.
Build once, start twice with different dotenv upstreams, verify env and health.
No upstream requests or credentials; .invalid URLs are deliberate test fixtures.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = ROOT / 'docker/docker-compose.yml'
ENV = {k: v for k, v in os.environ.items() if k not in {
    'NORISH_BASE_URL', 'POSTGRES_PASSWORD', 'BETTER_AUTH_SECRET',
    'ENCRYPTION_KEY', 'NORISH_API_KEY', 'SYNCLORIC_IMAGE', 'APP_PORT',
}}
VALUES = {
    'POSTGRES_PASSWORD': 'ci-only-disposable-db',
    'BETTER_AUTH_SECRET': 'ci-only-disposable-auth-not-a-real-secret-0123456789',
    'ENCRYPTION_KEY': '01' * 32,
    'SYNCLORIC_IMAGE': 'syncloric:deploy-smoke',
    'APP_PORT': '0',
}


def run(*args, check=True):
    return subprocess.run(args, cwd=ROOT, env=ENV, text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=check)


def main():
    with tempfile.TemporaryDirectory() as directory:
        envfile = Path(directory) / '.env'
        prefix = ['docker', 'compose', '-f', str(COMPOSE), '--env-file', str(envfile)]
        def configure(values):
            envfile.write_text(''.join(f'{key}={value}\n' for key, value in values.items()))
            envfile.chmod(0o600)

        values = {**VALUES, 'NORISH_BASE_URL': 'https://upstream-a.invalid'}
        # Both unset and empty mandatory variables fail with the variable named.
        for key in ['NORISH_BASE_URL', 'POSTGRES_PASSWORD', 'BETTER_AUTH_SECRET', 'ENCRYPTION_KEY']:
            for empty in [False, True]:
                candidate = dict(values)
                if empty:
                    candidate[key] = ''
                else:
                    del candidate[key]
                configure(candidate)
                result = run(*prefix, 'config', check=False)
                assert result.returncode != 0 and key in result.stderr, key
        configure(values)
        subprocess.run([*prefix, 'build', 'app'], cwd=ROOT, env=ENV, check=True)
        image_ids = []
        for suffix in ['a', 'b']:
            url = f'https://upstream-{suffix}.invalid'
            configure({**VALUES, 'NORISH_BASE_URL': url})
            cmd = [*prefix, '-p', f'syncloric-smoke-{suffix}']
            try:
                run(*cmd, 'up', '-d', '--no-build', '--wait', '--wait-timeout', '180')
                container = run(*cmd, 'ps', '-q', 'app').stdout.strip()
                info = json.loads(run('docker', 'inspect', container).stdout)[0]
                image_ids.append(info['Image'])
                assert f'NORISH_BASE_URL={url}' in info['Config']['Env']
                assert info['Config']['User'] == 'nextjs'
                assert info['State']['Health']['Status'] == 'healthy'
                run(*cmd, 'exec', '-T', 'app', 'node', '-e',
                    "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))")
                run(*cmd, 'exec', '-T', 'app', 'node', '-e',
                    "const fs=require('fs'); if(fs.existsSync('/app/.env') || fs.existsSync('/app/docker/.env')) process.exit(1)")
                print(f'PASS: {suffix}: runtime env, non-root, app/DB health, no dotenv in image', flush=True)
            finally:
                run(*cmd, 'down', '--volumes', '--remove-orphans')
        assert image_ids[0] == image_ids[1], 'different images used across instances'
        print('PASS: same image ID across both deployments; missing/empty env rejected', flush=True)


if __name__ == '__main__':
    main()
