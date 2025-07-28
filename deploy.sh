#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
STAMP=$(date +%Y-%m-%d-%H%M%S)
OUT=~/builds/$STAMP
mkdir -p "$OUT"

echo "▶ Staging files..."
rsync -az --delete --exclude deploy.sh --exclude .git \
      "$PROJECT_DIR"/ "$OUT"/

echo "▶ Publishing release..."
rsync -az --delete "$OUT"/ /var/www/cue.musicsian.com/releases/$STAMP/

echo "▶ Flipping current symlink..."
sudo ln -nfs /var/www/cue.musicsian.com/releases/$STAMP \
            /var/www/cue.musicsian.com/current

echo "▶ Restoring SELinux labels..."
sudo restorecon -Rv /var/www/cue.musicsian.com/releases/$STAMP >/dev/null

echo "▶ Reloading Nginx..."
sudo systemctl reload nginx

echo "✓ Deployed $STAMP to cue.musicsian.com"