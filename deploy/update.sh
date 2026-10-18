#!/bin/sh
# Self-hosting with git pull. One app serves every BorNiz host (bornis.id, app., pos., kds., display., order., admin.):
# src/system/hosts.ts picks the page from the Host header, so there is one folder, one build and one process.
#
# First time on the server (Node 20.9+, nginx):
#   git clone <repo> /srv/borniz && cd /srv/borniz
#   cp .env.example .env.production   # fill it: NEXT_PUBLIC_* values are baked in at build time
#   sudo cp deploy/borniz.service /etc/systemd/system/ && sudo systemctl enable borniz
#   sudo cp deploy/nginx.conf /etc/nginx/sites-enabled/borniz.conf   # set your domain and certificates
#   sh deploy/update.sh
# Every update after that: sh deploy/update.sh
# Database changes are not part of git pull: run new files in supabase/migrations/ in the Supabase SQL editor.
set -eu
cd "$(dirname "$0")/.."
[ -f .env.production ] || [ -f .env ] || { echo "Missing .env.production: copy .env.example and fill it."; exit 1; }
git pull --ff-only
npm ci
npm run build
sudo systemctl restart borniz
echo "BorNiz updated to $(git log --oneline -1)"
