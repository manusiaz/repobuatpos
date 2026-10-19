#!/bin/sh
# Switch a merchant's own domain on (Enterprise), as root, after they point a CNAME at menu.<root domain>:
#   sudo sh /srv/borniz/deploy/add-domain.sh order.kopibiru.id kopibiru
#   sudo sh /srv/borniz/deploy/add-domain.sh --remove order.kopibiru.id
# Gets the domain's certificate (HTTP challenge on port 80), serves it with nginx, adds it to
# NEXT_PUBLIC_BORNIZ_CUSTOM_DOMAINS and rebuilds: from then on its QR codes, receipts and links use the domain.
# The domain serves the business's guest pages (QR menu, kiosk, online store); staff pages stay on <slug>.<root>.
set -eu
cd "$(dirname "$0")/.."
[ "$(id -u)" = 0 ] || { echo "Run as root: sudo sh $0 $*"; exit 1; }
REMOVE=; [ "${1:-}" = --remove ] && { REMOVE=1; shift; }
HOST=$(echo "${1:-}" | tr 'A-Z' 'a-z'); SLUG=${2:-}
echo "$HOST" | grep -Eq '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$' || { echo "Usage: $0 [--remove] <domain> <business address>"; exit 1; }
ENV=.env.production; [ -f $ENV ] || { echo "Missing $ENV"; exit 1; }
OWNER=$(stat -c %U .)
CONF=/etc/nginx/borniz-domains/$HOST.conf
# the env file holds JSON: edited by node, never by sed
setmap() { node -e '
  const fs = require("fs"), [f, h, s] = process.argv.slice(1), re = /^NEXT_PUBLIC_BORNIZ_CUSTOM_DOMAINS=(.*)$/m;
  let t = fs.readFileSync(f, "utf8"); const m = t.match(re), map = m && m[1].trim() ? JSON.parse(m[1]) : {};
  if (s) map[h] = s; else delete map[h];
  const line = "NEXT_PUBLIC_BORNIZ_CUSTOM_DOMAINS=" + JSON.stringify(map);
  fs.writeFileSync(f, m ? t.replace(re, line) : t.replace(/\n?$/, "\n") + line + "\n");' "$ENV" "$HOST" "${1:-}"; }

if [ -n "$REMOVE" ]; then
  setmap ""; rm -f "$CONF"; nginx -t -q; systemctl reload nginx
else
  echo "$SLUG" | grep -Eq '^[a-z0-9][a-z0-9-]{1,40}$' || { echo "Usage: $0 <domain> <business address>"; exit 1; }
  ADMIN=$(sed -n 's/^DATABASE_ADMIN_URL=//p' $ENV)
  [ "$(psql "$ADMIN" -Atc "select count(*) from public.tenants where slug = '$SLUG'")" = 1 ] || { echo "No business at $SLUG"; exit 1; }
  ROOT=$(sed -n 's/^NEXT_PUBLIC_BORNIZ_ROOT_DOMAIN=//p' $ENV)
  if [ -f "/etc/letsencrypt/live/$ROOT/fullchain.pem" ]; then # https is on: this domain gets its own certificate
    mkdir -p /var/www/certbot /etc/nginx/borniz-domains
    certbot certonly --webroot -w /var/www/certbot -d "$HOST" --non-interactive --agree-tos --register-unsafely-without-email \
      --keep-until-expiring --deploy-hook "systemctl reload nginx"
    printf 'server {\n  listen 443 ssl http2;\n  server_name %s;\n  ssl_certificate     /etc/letsencrypt/live/%s/fullchain.pem;\n  ssl_certificate_key /etc/letsencrypt/live/%s/privkey.pem;\n  client_max_body_size 10m;\n  location / { include snippets/borniz-proxy.conf; }\n}\n' "$HOST" "$HOST" "$HOST" > "$CONF"
    nginx -t -q; systemctl reload nginx
  fi
  setmap "$SLUG"
fi
runuser -u "$OWNER" -- env HOME="$(getent passwd "$OWNER" | cut -d: -f6)" sh deploy/update.sh
echo "${REMOVE:+Removed }$HOST${REMOVE:- → $SLUG: live}"
