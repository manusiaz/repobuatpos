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
const hosts = HOSTS.map(h => (h.sub ? h.sub + '.' : '') + root);
console.log(`Domains to add to the hosting project (Vercel → Settings → Domains), all pointing at this one deployment:`);
for (const h of [root, 'www.' + root, ...hosts.filter(h => h !== root)]) console.log(`  ${h.padEnd(24)} ${h === root ? 'A     76.76.21.21' : 'CNAME cname.vercel-dns.com'}${h.startsWith('www.') ? '  (redirects to ' + root + ')' : ''}`);
console.log(`Env: NEXT_PUBLIC_BORNIZ_ROUTING=subdomain NEXT_PUBLIC_BORNIZ_ROOT_DOMAIN=${root}`);
console.log(`Merchant domains: CNAME → order.${root}, then add them to the project and to NEXT_PUBLIC_BORNIZ_CUSTOM_DOMAINS.`);
console.log(bad ? `${bad} pages not reachable` : `${PAGES.length}/${PAGES.length} pages reachable at their public URL`);
process.exit(bad ? 1 : 0);
