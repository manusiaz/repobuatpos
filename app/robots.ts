import type { MetadataRoute } from 'next';
// Only the marketing site and guest pages are for search engines; staff apps never are.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', allow: '/', disallow: ['/owner', '/manager', '/pos', '/pic', '/kds', '/display', '/admin', '/account', '/online', '/waiter', '/system', '/studios', '/graph'] } };
}
