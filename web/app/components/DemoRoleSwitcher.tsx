'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DEMO_ROLES, type DemoRole } from '../lib/demo-roles';

export default function DemoRoleSwitcher({ currentRole }: { currentRole: DemoRole }) {
  const router = useRouter();
  const [selectedRole, setSelectedRole] = useState(currentRole);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function switchRole(nextRole: DemoRole) {
    setSelectedRole(nextRole);
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/demo-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: nextRole }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || '역할을 변경하지 못했습니다.');
      router.refresh();
    } catch (switchError) {
      setSelectedRole(currentRole);
      setError(switchError instanceof Error ? switchError.message : '역할을 변경하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="demo-role-switcher">
      <span>화면 역할</span>
      <select
        aria-label="데모 화면 역할"
        value={selectedRole}
        disabled={busy}
        onChange={event => void switchRole(event.target.value as DemoRole)}
      >
        {(Object.keys(DEMO_ROLES) as DemoRole[]).map(role => (
          <option key={role} value={role}>{DEMO_ROLES[role].label}</option>
        ))}
      </select>
      {error && <small role="alert">{error}</small>}
    </label>
  );
}
