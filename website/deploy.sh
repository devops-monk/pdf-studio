#!/usr/bin/env bash
# Publishes the website to the VPS. Only touches /var/www/pdf-studio.
set -euo pipefail
HOST="${DEPLOY_HOST:-root@168.231.79.163}"
cd "$(dirname "$0")"
rsync -az --delete --exclude deploy.sh --exclude nginx ./ "$HOST:/var/www/pdf-studio/"
ssh "$HOST" 'chown -R www-data:www-data /var/www/pdf-studio && find /var/www/pdf-studio -type d -exec chmod 755 {} + && find /var/www/pdf-studio -type f -exec chmod 644 {} +'
echo "Deployed to https://pdf-studio.devops-monk.com/"
