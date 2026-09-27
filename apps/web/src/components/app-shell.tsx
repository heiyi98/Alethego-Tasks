'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { Sidebar } from './sidebar';

/** 左侧菜单 + 右侧内容。窄屏下菜单收进抽屉，由顶部按钮打开。 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // 切换页面后收起抽屉
  useEffect(() => setDrawerOpen(false), [pathname]);

  return (
    <div className={`app-shell${drawerOpen ? ' drawer-open' : ''}`}>
      <div className="app-sidebar">
        <Sidebar />
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
        </div>
        {children}
      </div>
    </div>
  );
}
