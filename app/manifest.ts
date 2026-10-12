import type { MetadataRoute } from 'next';
// Installable app: opens on the register, full screen. Icon = the brand mark (app/icon.svg), full-bleed so it also masks.
export default function manifest(): MetadataRoute.Manifest {
  return { name: 'BorNiz', short_name: 'BorNiz', start_url: '/pos', display: 'standalone', theme_color: '#FF6A00', background_color: '#FAFAFA',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }, { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }] };
}
