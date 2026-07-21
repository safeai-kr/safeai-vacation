'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function DecisionButtons({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState('');

  async function decide(action: 'approve' | 'reject') {
    setLoading(action);
    setError('');
    try {
      const response = await fetch(`/api/leave-requests/${encodeURIComponent(requestId)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '처리하지 못했습니다.');
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '처리 중 오류가 발생했습니다.');
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="mt-4">
      <div className="flex gap-2">
        <button className="approve-button" disabled={Boolean(loading)} onClick={() => decide('approve')}>
          {loading === 'approve' ? '처리 중…' : '승인'}
        </button>
        <button className="reject-button" disabled={Boolean(loading)} onClick={() => decide('reject')}>
          {loading === 'reject' ? '처리 중…' : '반려'}
        </button>
      </div>
      {error && <p className="form-error mt-2">{error}</p>}
    </div>
  );
}
