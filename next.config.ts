import type { NextConfig } from 'next';
const root = process.env.NEXT_PUBLIC_BORNIZ_ROOT_DOMAIN || 'bornis.id';
// Dev only: let `next dev` serve the subdomains (app., pos., kds. …) and *.localhost when testing subdomain routing locally.
const config: NextConfig = { reactStrictMode: true, allowedDevOrigins: [root, '*.' + root, '*.localhost'] };
export default config;
