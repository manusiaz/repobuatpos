// Domains → pages. All host logic lives in src/system/hosts.ts (tested); this only applies it to the request.
import { NextResponse, type NextRequest } from 'next/server';
import { config as hostConfig, resolve } from './src/system/hosts.ts';

const cfg = hostConfig();
export function proxy(req: NextRequest) {
  const r = resolve(req.headers.get('host') ?? '', req.nextUrl.pathname, cfg);
  if (r.type === 'redirect') { const u = new URL(r.url); if (!u.search) u.search = req.nextUrl.search; return NextResponse.redirect(u, 308); } // old QR codes carry ?o=<outlet>
  if (r.type === 'rewrite') {
    const url = req.nextUrl.clone();
    url.pathname = r.path;
    for (const [k, v] of Object.entries(r.query)) url.searchParams.set(k, v);
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}
export const config = { matcher: ['/((?!_next/|api/|iclock/|favicon|.*\\.(?:png|jpg|svg|ico|webp|txt|xml|json|webmanifest|css|js)$).*)'] };
