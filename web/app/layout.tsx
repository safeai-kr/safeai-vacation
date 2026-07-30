import type { Metadata } from 'next';
import { headers } from 'next/headers';
import DemoRoleSwitcher from './components/DemoRoleSwitcher';
import { getSession, isDemoMode, isLocalDemoRoleSwitchEnabled } from './lib/auth';
import { demoRoleForEmail } from './lib/demo-roles';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const headerStore = await headers();
  const host = headerStore.get('x-forwarded-host') ?? headerStore.get('host') ?? 'localhost:3456';
  const protocol = headerStore.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const origin = `${protocol}://${host}`;
  const title = '연차 관리 시스템';
  const description = '사내 연차 현황 및 신청 관리';
  return {
    title,
    description,
    metadataBase: new URL(origin),
    openGraph: { title, description, type: 'website' },
    twitter: { card: 'summary', title, description },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const demo = isDemoMode();
  const localDemoRoleSwitch = isLocalDemoRoleSwitchEnabled();

  return (
    <html lang="ko">
      <body>
        <header className="site-header">
          <div className="page-shell header-inner">
            <a href="/" className="brand-link" aria-label="연차 관리 홈">
              <span className="brand-mark" aria-hidden="true">연</span>
              <span>
                <strong>연차 관리 시스템</strong>
                <span>사내 연차 현황 및 신청 관리</span>
              </span>
            </a>

            <div className="header-actions">
              {session && localDemoRoleSwitch && (
                <DemoRoleSwitcher
                  key={session.email}
                  currentRole={demoRoleForEmail(session.email)}
                />
              )}
              {demo && <span className="demo-badge">데모 모드</span>}
              {session && (
                <div className="hidden text-right sm:block">
                  <strong className="block text-sm font-semibold text-slate-800">{session.name}</strong>
                  <span className="block max-w-56 truncate text-xs text-slate-500">{session.email}</span>
                </div>
              )}
              {session && !demo && (
                <a href="/api/auth/logout" className="secondary-button">로그아웃</a>
              )}
            </div>
          </div>
        </header>
        <main className="page-shell">{children}</main>
      </body>
    </html>
  );
}
