import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from '../../../../lib/auth';

const STATE_COOKIE = 'leave_portal_oauth_state';

function safeReturnTo(value: string) {
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleUserInfo {
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  hd?: string;
}

export async function GET(req: NextRequest) {
  const stateParam = req.nextUrl.searchParams.get('state');
  const code = req.nextUrl.searchParams.get('code');
  const stateCookie = req.cookies.get(STATE_COOKIE)?.value;

  if (!stateParam || !code || !stateCookie) {
    return NextResponse.json({ error: 'Invalid Google OAuth callback' }, { status: 400 });
  }

  let state: { state: string; returnTo: string };
  try {
    state = JSON.parse(stateCookie) as { state: string; returnTo: string };
  } catch {
    return NextResponse.json({ error: 'Invalid OAuth state' }, { status: 400 });
  }

  if (state.state !== stateParam) {
    return NextResponse.json({ error: 'OAuth state mismatch' }, { status: 400 });
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'Google OAuth credentials are required' }, { status: 500 });
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${req.nextUrl.origin}/api/auth/callback/google`,
    }),
  });
  const token = await tokenRes.json() as GoogleTokenResponse;
  if (!tokenRes.ok || !token.access_token) {
    return NextResponse.json({ error: token.error_description ?? token.error ?? 'Google token exchange failed' }, { status: 401 });
  }

  const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const user = await userRes.json() as GoogleUserInfo;
  const email = user.email?.toLowerCase() ?? '';
  const allowedDomain = process.env.GOOGLE_AUTH_DOMAIN ?? 'safeai.kr';

  if (!userRes.ok || !user.email_verified || !email.endsWith(`@${allowedDomain}`)) {
    return NextResponse.redirect(new URL('/unauthorized', req.nextUrl.origin));
  }

  const sessionToken = createSessionToken({
    email,
    name: user.name ?? email,
    picture: user.picture ?? '',
    hd: user.hd ?? allowedDomain,
  });

  const res = NextResponse.redirect(new URL(safeReturnTo(state.returnTo || '/'), req.nextUrl.origin));
  res.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  res.cookies.set(STATE_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
