'use client';
import { useApp } from '../app/context.tsx';
import { Empty } from '../ui/kit.tsx';

export default function Screen() {
  const { page } = useApp();
  return <Empty icon="hammer" title={page.name}>Screen "roles" is being built from spec/BorNiz {page.prototype}.dc.html.</Empty>;
}
