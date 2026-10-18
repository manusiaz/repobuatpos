import type { NextConfig } from 'next';
const root = process.env.NEXT_PUBLIC_BORNIZ_ROOT_DOMAIN || 'bornis.id';
// Staff surfaces never load inside another site's frame (clickjacking on PIN and approval sheets). Guest pages (QR menu,
// web store embed, kiosk) stay embeddable: merchants put the store on their own site with Studios › embed.
const STAFF = '/:area(owner|manager|pic|pos|admin|account|kds|display|waiter|graph)/:path*';
const config: NextConfig = {
  reactStrictMode: true,
  // The browser bundle knows whether this deployment has a database (the URL itself stays on the server).
  env: { NEXT_PUBLIC_BORNIZ_BACKEND: process.env.DATABASE_URL ? '1' : '' },
  poweredByHeader: false,
  // Dev only: let `next dev` serve the subdomains (app., pos., kds. …) and *.localhost when testing subdomain routing locally.
  allowedDevOrigins: [root, '*.' + root, '*.localhost'],
  async headers() {
    return [
      { source: '/:path*', headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self), payment=(self)' },
      ] },
      { source: STAFF, headers: [{ key: 'X-Frame-Options', value: 'DENY' }, { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" }] },
      { source: '/:area(owner|manager|pic|pos|admin|account|kds|display|waiter)', headers: [{ key: 'X-Frame-Options', value: 'DENY' }, { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" }] },
    ];
  },
};
export default config;
