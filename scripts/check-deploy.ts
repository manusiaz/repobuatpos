// Prints what a production deploy needs (domains + DNS) and proves every page is reachable at its public address.
import { config, publicUrl, resolve, HOSTS } from '../src/system/hosts.ts';
import { PAGES } from '../src/system/registry.ts';
const root = process.env.NEXT_PUBLIC_BORNIZ_ROOT_DOMAIN || 'bornis.id';
const cfg = config({ NEXT_PUBLIC_BORNIZ_ROUTING: 'subdomain', NEXT_PUBLIC_BORNIZ_ROOT_DOMAIN: root });
let bad = 0;
for (const p of PAGES) {
  const u = new URL(publicUrl(p.path, cfg)), r = resolve(u.host, u.pathname, cfg);
  const got = r.type === 'rewrite' ? r.path : r.type === 'next' ? u.pathname.replace(/\/$/, '') || '/' : null;
  if (got !== p.path) { bad++; console.log('NOT REACHABLE', p.path, '→', u.href, JSON.stringify(r)); }
}
const hosts = HOSTS.map(h => (h.sub ? h.sub + '.' : '') + root).filter(h => h !== root);
console.log('DNS (every name points at the one server running BorNiz, deploy/nginx.conf):');
console.log(`  ${root.padEnd(24)} A     <server IP>`);
console.log(`  ${('*.' + root).padEnd(24)} A     <server IP>   businesses at <slug>.${root}; also covers ${['www', ...hosts.map(h => h.split('.')[0])].join(', ')}, menu`);
console.log(`TLS: one certificate for ${root} + *.${root} (wildcard needs the DNS-01 challenge, e.g. certbot certonly --manual --preferred-challenges dns -d ${root} -d '*.${root}')`);
console.log(`Env: NEXT_PUBLIC_BORNIZ_ROUTING=subdomain NEXT_PUBLIC_BORNIZ_ROOT_DOMAIN=${root}`);
console.log(`Merchant domains: CNAME → menu.${root}, then list them in NEXT_PUBLIC_BORNIZ_CUSTOM_DOMAINS and in nginx server_name with their own certificate.`);
console.log(`Old QR codes at order.${root}/<slug>/… redirect to <slug>.${root}/….`);
console.log(bad ? `${bad} pages not reachable` : `${PAGES.length}/${PAGES.length} pages reachable at their public URL`);
process.exit(bad ? 1 : 0);
