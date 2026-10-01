'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type ReactNode } from 'react';

import { CurrentGroupProvider } from './current-group';
import { ModeToggle } from './mode-toggle';
import { Sidebar } from './sidebar';
import { needsCanonicalRedirect, parseSelection, selectionHref } from '@/lib/selection';

/** 切换页面、范围或组后收起抽屉；分类是多选开关，切换分类时抽屉保持打开 */
function CloseDrawerOnNavigate({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const scope = params.get('scope');
  const group = params.get('group');
  useEffect(() => onNavigate(), [pathname, scope, group, onNavigate]);
  return null;
}

/** 旧地址兼容：?status=starred 等旧写法改写成当前的规范地址 */
function CanonicalizeUrl() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const query = searchParams.toString();
  useEffect(() => {
    const params = new URLSearchParams(query);
    if (!needsCanonicalRedirect(params)) return;
    router.replace(selectionHref(parseSelection(pathname, params)));
  }, [pathname, query, router]);
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
        <CanonicalizeUrl />
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
        <Suspense>
          <CurrentGroupProvider>{children}</CurrentGroupProvider>
        </Suspense>
      </div>
    </div>
  );
}
