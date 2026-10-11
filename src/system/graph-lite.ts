// Client-safe slice of the graph (no authority/links JSON): pages that share a data object.
import { PAGES } from './registry.ts';
export const relatedPages = (path: string) => {
  const p = PAGES.find(x => x.path === path);
  return p?.object ? PAGES.filter(x => x.object === p.object && x.path !== path) : [];
};
