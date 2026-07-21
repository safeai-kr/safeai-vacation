import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '../../../lib/api-error';
import { getApiSession, isDemoMode, isSameOriginRequest } from '../../../lib/auth';
import { recordOperationFailure, upsertTeam } from '../../../lib/leave-store';

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  const session = await getApiSession();
  if (!session) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const body = await request.json().catch(() => null) as { id?: string; name?: string; managerEmail?: string } | null;
  if (!body?.name?.trim() || !body.managerEmail?.includes('@')) return NextResponse.json({ error: '팀 이름과 팀장 이메일을 확인해 주세요.' }, { status: 400 });
  if (isDemoMode()) return NextResponse.json({ ok: true, demo: true });
  try { return NextResponse.json({ ok: true, ...await upsertTeam(session.email, { id: body.id, name: body.name, managerEmail: body.managerEmail }) }); }
  catch (error) {
    await recordOperationFailure({ actorEmail: session.email, operation: 'UPSERT_TEAM', targetType: 'TEAM', targetId: body.id ?? body.name, error });
    const { message, expected } = apiErrorResponse(error, '팀을 저장하지 못했습니다. 관리자 실패 로그를 확인해 주세요.');
    const status = !expected ? 500 : message.includes('권한') ? 403 : message.includes('활성 사내 직원') ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
