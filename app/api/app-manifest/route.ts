// GET ?app=pos|kds|… → the web app manifest of one BorNiz app (src/system/apps.ts), its start page as served on this host.
import { APPS, type App } from '../../../src/system/apps.ts';
import { config, publicUrl, resolve } from '../../../src/system/hosts.ts';

export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  const u = new URL(req.url), key = (u.searchParams.get('app') ?? '') in APPS ? u.searchParams.get('app') as App : 'bornis', app = APPS[key];
  const host = req.headers.get('host') ?? u.host, origin = `${req.headers.get('x-forwarded-proto') ?? u.protocol.replace(':', '')}://${host}`, cfg = config();
  const tenant = (resolve(host, '/', cfg) as { query?: Record<string, string> }).query?.tenant;
  // installed from the merchant's own domain: starts there; from <slug>.<root>: starts there (an app never jumps host)
  const own = cfg.customDomains[host.split(':')[0]] ? host.split(':')[0] : '';
  const at = new URL(publicUrl(app.start, cfg, tenant ?? cfg.tenant, origin, own));
  return Response.json({
    id: '/?app=' + key, name: app.name, short_name: app.name.replace(/^BorNiz /, ''),
    start_url: at.host === host ? at.pathname + at.search : '/', scope: '/', display: 'standalone', theme_color: '#FF6A00', background_color: '#FAFAFA',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }, { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }],
  }, { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'public, max-age=300' } });
}
