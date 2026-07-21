import assert from 'node:assert/strict';
import test from 'node:test';
import { formatKstDateTime } from '../app/lib/date-format.ts';

test('처리 시각은 실행 환경의 로케일과 관계없이 KST 고정 형식으로 표시한다', () => {
  assert.equal(formatKstDateTime('2026-07-20T03:04:00Z'), '2026.07.20 12:04');
  assert.equal(formatKstDateTime('2026-07-20T03:04:00+09:00'), '2026.07.20 03:04');
  assert.equal(formatKstDateTime(''), '-');
});
