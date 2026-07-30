import { NextRequest, NextResponse } from 'next/server';
import {
  DEMO_ROLE_COOKIE,
  isLocalDemoRoleSwitchEnabled,
  isSameOriginRequest,
} from '../../lib/auth';
import { isDemoRole } from '../../lib/demo-roles';

export async function POST(request: NextRequest) {
  if (!isLocalDemoRoleSwitchEnabled()) {
    return NextResponse.json({ error: '로컬 데모 환경에서만 사용할 수 있습니다.' }, { status: 404 });
  }
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as { role?: unknown } | null;
  if (!isDemoRole(body?.role)) {
    return NextResponse.json({ error: '데모 역할을 확인해 주세요.' }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true, role: body.role });
  response.cookies.set(DEMO_ROLE_COOKIE, body.role, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 24 * 60 * 60,
  });
  return response;
}
