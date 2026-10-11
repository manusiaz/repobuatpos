import type { MetadataRoute } from 'next';
import { PAGES } from '../src/system/registry.ts';
import { config, publicUrl } from '../src/system/hosts.ts';
// Marketing pages only, at their public address (subdomain or subfolder mode).
export default function sitemap(): MetadataRoute.Sitemap {
  const cfg = config(), origin = `${cfg.protocol}://${cfg.root}`;
  return PAGES.filter(p => p.surface === 'landing').map(p => ({ url: publicUrl(p.path, cfg, cfg.tenant, origin), changeFrequency: 'weekly', priority: p.path === '/' ? 1 : 0.6 }));
}
