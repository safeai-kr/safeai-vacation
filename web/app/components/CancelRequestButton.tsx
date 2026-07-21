'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LeaveStatus } from '../lib/leave-store';

export default function CancelRequestButton({
  requestId,
  requestLabel,
  status,
  balanceWillRestore,
  adminMode = false,
}: {
  requestId: string;
  requestLabel: string;
  status: Extract<LeaveStatus, 'PENDING' | 'APPROVED'>;
  balanceWillRestore: boolean;
  adminMode?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'loading' | 'completed'>('idle');
  const [feedback, setFeedback] = useState<{ type: 'info' | 'error'; text: string } | null>(null);

  async function cancelRequest() {
    const confirmation = status === 'PENDING'
      ? '승인 대기 중인 신청을 취소할까요? 예약된 휴가가 다시 사용 가능해집니다.'
      : balanceWillRestore
        ? '승인된 신청을 취소할까요? 차감된 휴가가 복구됩니다.'
        : '이미 시작된 신청을 관리자 권한으로 취소할까요? 사용 내역과 잔여 휴가는 유지됩니다.';
    if (!window.confirm(confirmation)) return;

    setState('loading');
    setFeedback(null);
    try {
      const response = await fetch(`/api/leave-requests/${encodeURIComponent(requestId)}/cancel`, {
        method: 'POST',
      });
      const result = await response.json() as { error?: string; demo?: boolean };
      if (!response.ok) throw new Error(result.error || '신청을 취소하지 못했습니다.');
      if (result.demo) {
        setState('idle');
        setFeedback({ type: 'info', text: '데모 모드에서는 취소 결과가 저장되지 않습니다.' });
        return;
      }
      setState('completed');
      router.refresh();
    } catch (error) {
      setState('idle');
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : '취소 중 오류가 발생했습니다.' });
    }
  }

  return (
    <div className="cancel-action">
      <button
        type="button"
        className="cancel-button"
        disabled={state !== 'idle'}
        aria-busy={state === 'loading'}
        aria-label={`${requestLabel} ${adminMode ? '관리자 취소' : '신청 취소'}`}
        onClick={cancelRequest}
      >
        {state === 'loading' ? '취소 중…' : state === 'completed' ? '취소 완료' : adminMode ? '관리자 취소' : '신청 취소'}
      </button>
      {feedback && (
        <p
          className={`inline-action-message ${feedback.type === 'error' ? 'is-error' : 'is-info'}`}
          role={feedback.type === 'error' ? 'alert' : 'status'}
        >
          {feedback.text}
        </p>
      )}
    </div>
  );
}
