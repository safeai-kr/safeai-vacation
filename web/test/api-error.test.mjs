import assert from 'node:assert/strict';
import test from 'node:test';
import { apiErrorResponse, DomainError } from '../app/lib/api-error.ts';

test('예상한 업무 오류는 사용자 메시지를 유지한다', () => {
  assert.deepEqual(apiErrorResponse(new DomainError('잔여 연차가 부족합니다.'), '처리하지 못했습니다.'), {
    message: '잔여 연차가 부족합니다.',
    expected: true,
  });
});

test('내부 인프라 오류 원문은 일반 응답에 노출하지 않는다', () => {
  assert.deepEqual(apiErrorResponse(new Error('7 PERMISSION_DENIED: project metadata'), '처리하지 못했습니다.'), {
    message: '처리하지 못했습니다.',
    expected: false,
  });
  assert.deepEqual(apiErrorResponse(new Error('FIREBASE_PROJECT_ID가 설정되지 않았습니다.'), '처리하지 못했습니다.'), {
    message: '처리하지 못했습니다.',
    expected: false,
  });
});
