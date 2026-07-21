import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

const STATE_COOKIE = 'leave_portal_oauth_state';

function safeReturnTo(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'GOOGLE_OAUTH_CLIENT_ID is required' }, { status: 500 });
  }

  const origin = req.nextUrl.origin;
  const returnTo = safeReturnTo(req.nextUrl.searchParams.get('returnTo'));
  const state = crypto.randomBytes(24).toString('hex');
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', `${origin}/api/auth/callback/google`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('hd', process.env.GOOGLE_AUTH_DOMAIN ?? 'safeai.kr');
  authUrl.searchParams.set('prompt', 'select_account');

  const res = NextResponse.redirect(authUrl);
  res.cookies.set(STATE_COOKIE, JSON.stringify({ state, returnTo }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 10 * 60,
  });
  return res;
}
