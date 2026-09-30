import { NextResponse, type NextRequest } from 'next/server';

// Optimistic gate only: redirects visitors without a session cookie to /login.
// The real check (session row in Postgres, not expired, not revoked) runs in every
// protected layout, route handler and server action via requireSession().
// /api/whatsapp/media is deliberately public: WAHA (outside this app, no session cookie) must be
// able to fetch a template's uploaded media by its unguessable id — see docs/WHATSAPP.md.
const PUBLIC = [/^\/login$/, /^\/api\/health$/, /^\/api\/ingest\//, /^\/api\/whatsapp\/media\//, /^\/favicon\.svg$/, /^\/robots\.txt$/];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  if (!req.cookies.get('rks_session')?.value) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
