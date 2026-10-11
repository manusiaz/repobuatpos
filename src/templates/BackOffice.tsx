'use client';
import { useApp } from '../app/context.tsx';
export default function BackOffice() { const { page } = useApp(); return <h1>{page.name}</h1>; }
