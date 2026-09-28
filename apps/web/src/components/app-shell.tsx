'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type ReactNode } from 'react';

import { ModeToggle } from './mode-toggle';
import { Sidebar } from './sidebar';

/** 切换页面或状态后收起抽屉；分类是多选开关，切换分类时抽屉保持打开 */
function CloseDrawerOnNavigate({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();
  const status = useSearchParams().get('status');
  useEffect(() => onNavigate(), [pathname, status, onNavigate]);
  return null;
}

/** 左侧菜单 + 右侧内容。窄屏下菜单收进抽屉，由顶部按钮打开。 */
export function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [closeDrawer] = useState(() => () => setDrawerOpen(false));

  return (
    <div className={`app-shell${drawerOpen ? ' drawer-open' : ''}`}>
      <Suspense>
        <CloseDrawerOnNavigate onNavigate={closeDrawer} />
      </Suspense>
      <div className="app-sidebar">
        <Suspense>
          <Sidebar />
        </Suspense>
      </div>
      {drawerOpen && (
        <button
          type="button"
          className="drawer-backdrop"
          aria-label="关闭菜单"
          onClick={() => setDrawerOpen(false)}
        />
      )}
      <div className="app-main">
        <div className="mobile-bar">
          <button
            type="button"
            className="menu-button"
            aria-label="打开菜单"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            ☰
          </button>
          <span className="mobile-brand">Alethego</span>
          <Suspense>
            <ModeToggle />
          </Suspense>
        </div>
        {children}
      </div>
    </div>
  );
}
