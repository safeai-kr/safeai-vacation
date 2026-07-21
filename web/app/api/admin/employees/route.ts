import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '../../../lib/api-error';
import { getApiSession, isDemoMode, isSameOriginRequest } from '../../../lib/auth';
import { type EmployeeInput, type EmployeeStatus, type Permission, type Position, recordOperationFailure, upsertEmployee } from '../../../lib/leave-store';

const POSITIONS = new Set<Position>(['EMPLOYEE', 'TEAM_LEAD', 'REPRESENTATIVE']);
const PERMISSIONS = new Set<Permission>(['GENERAL', 'ADMIN']);
const EMPLOYMENT_STATUSES = new Set<EmployeeStatus>(['ACTIVE', 'ON_LEAVE', 'RESIGNED', 'INACTIVE']);

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  const session = await getApiSession();
  if (!session) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const body = await request.json().catch(() => null) as Partial<EmployeeInput> | null;
  const position = body?.position as Position;
  const permission = body?.permission as Permission;
  const employmentStatus = body?.employmentStatus as EmployeeStatus;
  if (!body?.email?.includes('@') || !body.name?.trim() || !POSITIONS.has(position) || !PERMISSIONS.has(permission)) return NextResponse.json({ error: '직원 정보를 확인해 주세요.' }, { status: 400 });
  if (!EMPLOYMENT_STATUSES.has(employmentStatus)) return NextResponse.json({ error: '재직 상태를 확인해 주세요.' }, { status: 400 });
  const hireDate = String(body.hireDate ?? '');
  const openingAnnualUsedDays = Number(body.openingAnnualUsedDays ?? 0);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hireDate)) return NextResponse.json({ error: '입사일을 확인해 주세요.' }, { status: 400 });
  if (!Number.isFinite(openingAnnualUsedDays) || openingAnnualUsedDays < 0 || (openingAnnualUsedDays * 2) % 1 !== 0) return NextResponse.json({ error: '기존 사용 연차는 0.5일 단위로 입력해 주세요.' }, { status: 400 });
  if (isDemoMode()) return NextResponse.json({ ok: true, demo: true });
  try {
    return NextResponse.json({ ok: true, ...await upsertEmployee(session.email, { email: body.email, name: body.name, hireDate, teamId: body.teamId ?? '', position, permission, slackUserId: body.slackUserId ?? '', replacementManagerEmail: body.replacementManagerEmail ?? '', openingAnnualUsedDays, employmentStatus }) });
  } catch (error) {
    await recordOperationFailure({ actorEmail: session.email, operation: 'UPSERT_EMPLOYEE', targetType: 'EMPLOYEE', targetId: body.email, error });
    const { message, expected } = apiErrorResponse(error, '직원을 저장하지 못했습니다. 관리자 실패 로그를 확인해 주세요.');
    const status = !expected
      ? 500
      : message.includes('직원 관리 권한')
      ? 403
      : message.includes('찾을 수 없')
        ? 404
        : message.includes('비활성화할 수 없') || message.includes('활성 사내 직원') || message.includes('승인 대기 신청') || message.includes('마지막 활성 관리자')
          ? 409
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
