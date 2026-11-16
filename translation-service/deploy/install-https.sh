#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
domain=${1:?Usage: install-https.sh translate.example.com}
if [[ "$EUID" != 0 || ! "$domain" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo 'Run as root with a valid DNS hostname' >&2; exit 1
fi
test -s "/etc/letsencrypt/live/$domain/fullchain.pem"
python3 - "$domain" <<'PY'
import json, os, pathlib, secrets, sys
domain = sys.argv[1]
credentials = pathlib.Path('/etc/tubitle-translation-access.json')
if credentials.exists():
    token = json.loads(credentials.read_text())['tubitleApiKey']
else:
    token = secrets.token_hex(32)
payload = {'tubitleBaseUrl': f'https://{domain}', 'tubitleApiKey': token}
credentials.write_text(json.dumps(payload, indent=2) + '\n')
os.chmod(credentials, 0o600)
auth = pathlib.Path('/etc/nginx/conf.d/tubitle-auth.conf')
auth.write_text('map_hash_bucket_size 128;\nmap $http_authorization $tubitle_authorized {\n    default 0;\n    "Bearer ' + token + '" 1;\n}\n')
os.chmod(auth, 0o600)
template = pathlib.Path('deploy/nginx.conf.template').read_text()
pathlib.Path('/etc/nginx/sites-available/tubitle-translation').write_text(template.replace('__DOMAIN__', domain))
PY
ln -sfn /etc/nginx/sites-available/tubitle-translation /etc/nginx/sites-enabled/tubitle-translation
nginx -t
systemctl reload nginx
install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/tubitle-nginx.sh <<'SH'
#!/usr/bin/env bash
set -euo pipefail
nginx -t
systemctl reload nginx
SH
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/tubitle-nginx.sh
systemctl enable --now certbot.timer
echo 'HTTPS configured; credentials stored in /etc/tubitle-translation-access.json (root only)'
