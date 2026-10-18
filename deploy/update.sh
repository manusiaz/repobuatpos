#!/bin/sh
# Self-hosting with git pull. One app serves every BorNiz host (bornis.id, app., pos., kds., display., order., admin.):
# src/system/hosts.ts picks the page from the Host header, so there is one folder, one build and one process.
#
# First time on the server (Node 20.9+, PostgreSQL 14+, nginx):
#   sudo -u postgres psql -c "create role borniz_owner login createrole password '<owner password>'" \
#     -c "create role borniz_app login password '<app password>'" -c "create database borniz owner borniz_owner"
#   (neither role is a superuser: the owner runs the migrations, the app connects as borniz_app)
#   git clone <repo> /srv/borniz && cd /srv/borniz
#   cp .env.example .env.production   # fill it: DATABASE_URL (borniz_app), DATABASE_ADMIN_URL (borniz_owner), BORNIZ_SERVER_SECRET …
#   sudo cp deploy/borniz.service /etc/systemd/system/ && sudo systemctl enable borniz
#   sudo cp deploy/nginx.conf /etc/nginx/sites-enabled/borniz.conf   # set your domain and certificates
#   sh deploy/update.sh
# Every update after that: sh deploy/update.sh
# Every run installs the database changes that came with the pull (npm run db:migrate: each migration once).
set -eu
cd "$(dirname "$0")/.."
[ -f .env.production ] || [ -f .env ] || { echo "Missing .env.production: copy .env.example and fill it."; exit 1; }
git pull --ff-only
npm ci
ENV=.env.production; [ -f $ENV ] || ENV=.env
node --env-file=$ENV scripts/db-migrate.mjs
npm run build
sudo systemctl restart borniz
echo "BorNiz updated to $(git log --oneline -1)"
