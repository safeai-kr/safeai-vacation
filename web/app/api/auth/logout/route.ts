import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../../../lib/auth';

export async function GET(req: NextRequest) {
  const returnTo = req.nextUrl.searchParams.get('returnTo') || '/';
  const res = NextResponse.redirect(new URL(returnTo, req.nextUrl.origin));
  res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
