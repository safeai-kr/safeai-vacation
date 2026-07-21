import 'server-only';

import crypto from 'crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export interface SessionUser {
  email: string;
  name: string;
  picture: string;
  hd: string;
  exp: number;
}

const SESSION_COOKIE = 'leave_portal_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;

export function isDemoMode() {
  return process.env.LEAVE_DEMO_MODE === 'true';
}

export function isLocalAuthBypass() {
  return process.env.NODE_ENV !== 'production' && process.env.LOCAL_AUTH_BYPASS === 'true';
}

function localUser(): SessionUser {
  const email = (process.env.LOCAL_AUTH_EMAIL ?? process.env.FIREBASE_ADMIN_EMAILS?.split(',')[0] ?? '')
    .trim()
    .toLowerCase();
  if (!email) throw new Error('LOCAL_AUTH_EMAIL is required when LOCAL_AUTH_BYPASS is enabled');
  return {
    email,
    name: email.split('@')[0],
    picture: '',
    hd: email.split('@')[1] ?? '',
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
}

function demoUser(): SessionUser {
  return {
    email: 'ceo@safeai.kr',
    name: '김대표',
    picture: '',
    hd: process.env.GOOGLE_AUTH_DOMAIN ?? 'safeai.kr',
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
}

function authSecret() {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is required for authentication');
  return secret;
}

function base64Url(input: Buffer | string) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromBase64Url(input: string) {
  const padded = input.padEnd(input.length + ((4 - (input.length % 4)) % 4), '=');
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(payload: string) {
  return base64Url(crypto.createHmac('sha256', authSecret()).update(payload).digest());
}

function timingSafeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function createSessionToken(user: Omit<SessionUser, 'exp'>) {
  const payload = base64Url(JSON.stringify({
    ...user,
    email: user.email.toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  }));
  return `${payload}.${sign(payload)}`;
}

export async function getSession(): Promise<SessionUser | null> {
  if (isDemoMode()) return demoUser();
  if (isLocalAuthBypass()) return localUser();

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [payload, signature] = token.split('.');
  if (!payload || !signature || !timingSafeEqual(sign(payload), signature)) return null;

  try {
    const session = JSON.parse(fromBase64Url(payload).toString('utf8')) as SessionUser;
    if (!session.email || !session.exp || session.exp < Math.floor(Date.now() / 1000)) return null;
    return { ...session, email: session.email.toLowerCase() };
  } catch {
    return null;
  }
}

export function isCompanyEmail(email: string) {
  if (isDemoMode() || isLocalAuthBypass()) return true;
  const domain = (process.env.GOOGLE_AUTH_DOMAIN ?? 'safeai.kr').toLowerCase();
  return email.toLowerCase().endsWith(`@${domain}`);
}

export async function requireCompanyAccess(returnTo: string) {
  const session = await getSession();
  if (!session) redirect(`/api/auth/google?returnTo=${encodeURIComponent(returnTo)}`);
  if (!isCompanyEmail(session.email)) redirect(`/unauthorized?returnTo=${encodeURIComponent(returnTo)}`);
  return session;
}

export async function getApiSession() {
  const session = await getSession();
  if (!session || !isCompanyEmail(session.email)) return null;
  return session;
}

export function isSameOriginRequest(request: Request) {
  if (isLocalAuthBypass()) return true;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export { SESSION_COOKIE, SESSION_TTL_SECONDS };
