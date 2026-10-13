// The machine polls for commands; BorNiz sends none.
export const dynamic = 'force-dynamic';
export const GET = () => new Response('OK', { headers: { 'content-type': 'text/plain' } });
