'use client';

import { ReactNode, useEffect, useState } from 'react';

export type DashboardTab = 'overview' | 'requests' | 'approvals' | 'rewards' | 'employees' | 'history';

type TabItem = {
  id: DashboardTab;
  label: string;
  badge?: number;
};

export function DashboardTabs({
  initialTab,
  tabs,
  children,
}: {
  initialTab: DashboardTab;
  tabs: TabItem[];
  children: ReactNode;
}) {
  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    const handlePopState = () => {
      const requestedTab = new URL(window.location.href).searchParams.get('tab') as DashboardTab | null;
      setActiveTab(tabs.some(tab => tab.id === requestedTab) ? requestedTab! : 'overview');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [tabs]);

  function activateTab(tab: DashboardTab) {
    if (tab === activeTab) return;
    setActiveTab(tab);
    const url = tab === 'overview' ? window.location.pathname : `${window.location.pathname}?tab=${tab}`;
    window.history.pushState(null, '', url);
  }

  return (
    <>
      <nav className="tab-nav" aria-label="연차 관리 메뉴" role="tablist">
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`dashboard-panel-${tab.id}`}
            className={activeTab === tab.id ? 'active' : ''}
            onClick={() => activateTab(tab.id)}
          >
            {tab.label}
            {Boolean(tab.badge) && <span>{tab.badge}</span>}
          </button>
        ))}
      </nav>
      <div data-active-dashboard-tab={activeTab}>{children}</div>
    </>
  );
}

export function DashboardTabPanel({
  tab,
  children,
}: {
  tab: DashboardTab;
  children: ReactNode;
}) {
  return (
    <section
      id={`dashboard-panel-${tab}`}
      className="dashboard-tab-panel"
      data-dashboard-tab-panel={tab}
      role="tabpanel"
    >
      {children}
    </section>
  );
}
