#!/bin/sh
# One-time server setup (Ubuntu 22.04 / 24.04, as root). Safe to run again: it only adds what is missing.
#   sudo DOMAIN=bornis.id sh setup-vps.sh
# One server holds two copies of the same app, each with its own database in the same PostgreSQL:
#   live  /srv/borniz       database borniz      served by nginx on DOMAIN and *.DOMAIN (systemd: borniz)
#   dev   /srv/borniz-dev   database borniz_dev  npm run dev on localhost:3001, reached through an SSH tunnel
# Both belong to the system user `borniz`; the GitHub deploy key it prints needs write access (you push from dev).
# Run it again after adding the deploy key, and again after the wildcard certificate exists (it then turns on https).
set -eu
DOMAIN=${DOMAIN:-bornis.id}
REPO=${REPO:-git@github.com:manusiaz/repobuatpos.git}
LIVE=${LIVE:-/srv/borniz}
DEV=${DEV:-/srv/borniz-dev}
U=borniz
[ "$(id -u)" = 0 ] || { echo "Run as root: sudo sh $0"; exit 1; }
as() { runuser -u $U -- env HOME="$(getent passwd $U | cut -d: -f6)" "$@"; }
pw() { openssl rand -hex 24; }
val() { sed -n "s|^$1=||p" "$2" | head -1; }

echo "== packages"
apt-get update -qq
apt-get install -y -qq git curl openssl openssh-client nginx postgresql postgresql-contrib >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null; apt-get install -y -qq nodejs >/dev/null
fi
# next build needs ~2 GB: small servers get a swap file
if [ "$(awk '/MemTotal/{print $2}' /proc/meminfo)" -lt 3000000 ] && ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile; chmod 600 /swapfile; mkswap /swapfile >/dev/null; swapon /swapfile; echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== user $U and its GitHub key"
id $U >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash $U
H=$(getent passwd $U | cut -d: -f6)
[ -f "$H/.ssh/id_ed25519" ] || as ssh-keygen -q -t ed25519 -N '' -C "borniz@$(hostname)" -f "$H/.ssh/id_ed25519"
as sh -c 'ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts 2>/dev/null; sort -u -o ~/.ssh/known_hosts ~/.ssh/known_hosts'
if ! as git ls-remote "$REPO" >/dev/null 2>&1; then
  echo "This server cannot read $REPO yet. On GitHub: repo → Settings → Deploy keys → Add, tick \"Allow write access\", paste:"
  cat "$H/.ssh/id_ed25519.pub"
  echo "Then run this script again."; exit 1
fi
echo "$U ALL=(root) NOPASSWD: /usr/bin/systemctl restart borniz" > /etc/sudoers.d/borniz; chmod 440 /etc/sudoers.d/borniz

echo "== folders"
for d in "$LIVE" "$DEV"; do
  [ -d "$d/.git" ] || { mkdir -p "$d" && chown $U: "$d" && as git clone -q "$REPO" "$d"; }
done

echo "== settings (passwords are generated once and stay in the env files, never printed)"
CERT=/etc/letsencrypt/live/$DOMAIN/fullchain.pem
PROTO=http; [ -f "$CERT" ] && PROTO=https
LENV=$LIVE/.env.production DENV=$DEV/.env.development.local
if [ ! -f "$LENV" ]; then
  OPW=$(pw) APW=$(pw)
  sed -e "s|^NEXT_PUBLIC_BORNIZ_ROUTING=.*|NEXT_PUBLIC_BORNIZ_ROUTING=subdomain|" \
      -e "s|^NEXT_PUBLIC_BORNIZ_ROOT_DOMAIN=.*|NEXT_PUBLIC_BORNIZ_ROOT_DOMAIN=$DOMAIN|" \
      -e "s|^DATABASE_URL=.*|DATABASE_URL=postgres://borniz_app:$APW@localhost:5432/borniz|" \
      -e "s|^DATABASE_ADMIN_URL=.*|DATABASE_ADMIN_URL=postgres://borniz_owner:$OPW@localhost:5432/borniz|" \
      -e "s|^BORNIZ_SERVER_SECRET=.*|BORNIZ_SERVER_SECRET=$(pw)|" "$LIVE/.env.example" > "$LENV"
fi
sed -i "s|^NEXT_PUBLIC_BORNIZ_PROTOCOL=.*|NEXT_PUBLIC_BORNIZ_PROTOCOL=$PROTO|" "$LENV"
APW=$(val DATABASE_URL "$LENV" | sed 's|^postgres://[^:]*:\([^@]*\)@.*|\1|')
OPW=$(val DATABASE_ADMIN_URL "$LENV" | sed 's|^postgres://[^:]*:\([^@]*\)@.*|\1|')
if [ ! -f "$DENV" ]; then
  sed -e "s|^NEXT_PUBLIC_BORNIZ_ROUTING=.*|NEXT_PUBLIC_BORNIZ_ROUTING=path|" \
      -e "s|^NEXT_PUBLIC_BORNIZ_PROTOCOL=.*|NEXT_PUBLIC_BORNIZ_PROTOCOL=http|" \
      -e "s|^DATABASE_URL=.*|DATABASE_URL=postgres://borniz_app:$APW@localhost:5432/borniz_dev|" \
      -e "s|^DATABASE_ADMIN_URL=.*|DATABASE_ADMIN_URL=postgres://borniz_owner:$OPW@localhost:5432/borniz_dev|" \
      -e "s|^BORNIZ_SERVER_SECRET=.*|BORNIZ_SERVER_SECRET=$(pw)|" "$DEV/.env.example" > "$DENV"
fi
chown $U: "$LENV" "$DENV"; chmod 600 "$LENV" "$DENV"

echo "== databases borniz + borniz_dev"
# heredoc on stdin, not arguments: the passwords never show in the process list
runuser -u postgres -- psql -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
select 'create role borniz_owner' where not exists (select from pg_roles where rolname = 'borniz_owner') \gexec
select 'create role borniz_app' where not exists (select from pg_roles where rolname = 'borniz_app') \gexec
alter role borniz_owner login createrole nosuperuser password '$OPW';
alter role borniz_app login nosuperuser password '$APW';
select 'create database borniz owner borniz_owner' where not exists (select from pg_database where datname = 'borniz') \gexec
select 'create database borniz_dev owner borniz_owner' where not exists (select from pg_database where datname = 'borniz_dev') \gexec
SQL
(cd "$DEV" && as npm ci --silent && as node --env-file="$DENV" scripts/db-migrate.mjs)

echo "== service + nginx ($PROTO)"
sed "s|^WorkingDirectory=.*|WorkingDirectory=$LIVE|" "$LIVE/deploy/borniz.service" > /etc/systemd/system/borniz.service
systemctl daemon-reload; systemctl enable -q borniz
if [ "$PROTO" = https ]; then sed "s|bornis\.id|$DOMAIN|g" "$LIVE/deploy/nginx.conf"
else # no certificate yet: every host on plain http, same app
  printf 'server {\n  listen 80;\n  server_name %s *.%s;\n  client_max_body_size 10m;\n  location / {\n    proxy_pass http://localhost:3000;\n    proxy_http_version 1.1;\n    proxy_set_header Host $host;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    proxy_set_header X-Forwarded-Proto $scheme;\n    proxy_buffering off;\n  }\n}\n' "$DOMAIN" "$DOMAIN"
fi > /etc/nginx/sites-enabled/borniz.conf
nginx -t -q
systemctl reload nginx

echo "== build and start live"
sh "$LIVE/deploy/update.sh"

cat <<EOF

Done. Live: $PROTO://$DOMAIN (and every <slug>.$DOMAIN).
DNS (at your registrar): A  $DOMAIN  and  A  *.$DOMAIN  → this server's IP.
EOF
[ "$PROTO" = https ] || cat <<EOF
https: the wildcard certificate needs the DNS challenge (a TXT record you add when certbot asks):
  apt-get install -y certbot && certbot certonly --manual --preferred-challenges dns -d $DOMAIN -d '*.$DOMAIN'
  then run this script again. (--manual does not renew itself: with Cloudflare DNS use python3-certbot-dns-cloudflare.)
EOF
cat <<EOF
Develop on this server (as $U, in $DEV, database borniz_dev — live data is never touched):
  sudo -iu $U; cd $DEV; npm run dev -- -p 3001
  on your computer: ssh -L 3001:localhost:3001 <you>@<server>  → http://localhost:3001  (VS Code Remote-SSH forwards it for you)
  done: git commit + git push, then on live: sudo -u $U sh $LIVE/deploy/update.sh
  new migration in dev: node --env-file=.env.development.local scripts/db-migrate.mjs
EOF
