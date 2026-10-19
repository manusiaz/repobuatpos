import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { PAGES, pageAt } from '../../src/system/registry.ts';
import { appOf } from '../../src/system/apps.ts';
import App from '../../src/app/App.tsx';

// One route for the whole product: every sitemap page is generated from the registry at build time.
export const dynamicParams = false;
export function generateStaticParams() { return PAGES.map(p => ({ slug: p.path === '/' ? [] : p.path.slice(1).split('/') })); }

type Props = { params: Promise<{ slug?: string[] }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = pageAt('/' + ((await params).slug ?? []).join('/'));
  return { title: p ? (p.path === '/' ? 'BorNiz · Cloud POS for Indonesian F&B and retail' : `${p.title} · BorNiz`) : 'BorNiz', description: p ? `${p.area} · ${p.group}` : undefined,
    manifest: '/api/app-manifest?app=' + (p ? appOf(p.surface, p.path) : 'bornis') };
}
export default async function Page({ params }: Props) {
  const path = '/' + ((await params).slug ?? []).join('/');
  if (!pageAt(path)) notFound();
  return <App path={path} />;
}
