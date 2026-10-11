import Link from 'next/link';
export default function NotFound() {
  return <div className="empty" style={{ minHeight: '80dvh', justifyContent: 'center' }}>
    <span className="cap">404</span><h1 style={{ color: 'var(--fg-1)' }}>This page doesn’t exist</h1>
    <p>Every BorNiz page comes from the sitemap. Use the Apps launcher or go back home.</p>
    <Link className="btn btn-primary" href="/">Go home</Link>
  </div>;
}
