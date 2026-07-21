export default async function UnauthorizedPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const params = await searchParams;
  const returnTo = params.returnTo?.startsWith('/') ? params.returnTo : '/';
  return (
    <section className="empty-state max-w-xl mx-auto text-center">
      <span className="eyebrow">Access denied</span>
      <h1>접근 권한을 확인해 주세요.</h1>
      <p>회사 Google 계정으로 로그인했는지, Firebase 직원 목록에 활성 직원으로 등록되어 있는지 확인해 주세요.</p>
      <div className="mt-7 flex justify-center gap-2">
        <a href="/api/auth/logout" className="secondary-button">로그아웃</a>
        <a href={`/api/auth/google?returnTo=${encodeURIComponent(returnTo)}`} className="primary-button">다시 로그인</a>
      </div>
    </section>
  );
}
