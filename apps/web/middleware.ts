import { PUBLIC_ROUTES, ROUTES } from '@bond-os/shared';
import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Route-level auth gating only — a fast, Edge-safe check of the session
 * cookie's presence (no DB hit). Route Handlers still call `requireAuth()`
 * server-side for the authoritative check; this just avoids flashing
 * protected pages before redirecting. `/api/*` is excluded via `matcher`
 * below — API routes return 401 JSON instead of an HTML redirect.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(getSessionCookie(request));

  const isPublicRoute = PUBLIC_ROUTES.some((route) => pathname.startsWith(route));

  if (!hasSession && !isPublicRoute && pathname !== ROUTES.home) {
    const loginUrl = new URL(ROUTES.login, request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (hasSession && isPublicRoute) {
    return NextResponse.redirect(new URL(ROUTES.dashboard, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api).*)'],
};
