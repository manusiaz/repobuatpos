#!/bin/sh
# Self-hosting with git pull. One app serves every BorNiz host (bornis.id, app., admin. and every <slug>.bornis.id):
# src/system/hosts.ts picks the page from the Host header, so there is one folder, one build and one process.
# First time: deploy/setup-vps.sh (packages, user borniz, databases, env file, service, nginx, then this script).
# Every update after that: sudo -u borniz sh /srv/borniz/deploy/update.sh
# Every run installs the database changes that came with the pull (npm run db:migrate: each migration once).
set -eu
cd "$(dirname "$0")/.."
# run as the folder's owner (git refuses a folder owned by someone else; the build must stay writable by the service)
OWNER=$(stat -c %U .)
[ "$(id -un)" = "$OWNER" ] || exec runuser -u "$OWNER" -- env HOME="$(getent passwd "$OWNER" | cut -d: -f6)" sh "$PWD/deploy/update.sh"
[ -f .env.production ] || [ -f .env ] || { echo "Missing .env.production: copy .env.example and fill it."; exit 1; }
git pull --ff-only
npm ci
ENV=.env.production; [ -f $ENV ] || ENV=.env
node --env-file=$ENV scripts/db-migrate.mjs
# build next to the live one: a failed build changes nothing, and visitors never get half-written files
rm -rf .next-new
BORNIZ_BUILD_DIR=.next-new npm run build
rm -rf .next-old; [ -d .next ] && mv .next .next-old; mv .next-new .next
sudo systemctl restart borniz
sudo systemctl restart borniz-worker # alerts, escalations, gateway settlement and messages with no device open
echo "BorNiz updated to $(git log --oneline -1)"
