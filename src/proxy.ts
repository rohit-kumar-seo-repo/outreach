import { NextResponse, type NextRequest } from 'next/server';

// Optimistic gate only: redirects visitors without a session cookie to /login.
// The real check (session row in Postgres, not expired, not revoked) runs in every
// protected layout, route handler and server action via requireSession().
const PUBLIC = [/^\/login$/, /^\/api\/health$/, /^\/api\/ingest\//, /^\/favicon\.svg$/, /^\/robots\.txt$/];

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
