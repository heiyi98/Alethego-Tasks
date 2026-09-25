'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const VIEWS = [
  { href: '/', label: '列表' },
  { href: '/matrix', label: '矩阵' },
] as const;

/** 主界面是列表；矩阵是可选打开的可视化视图 */
export function ViewNav({ title }: { title: string }) {
  const pathname = usePathname();
  return (
    <header className="page-header">
      <h1>{title}</h1>
      <nav className="view-nav" aria-label="视图">
        {VIEWS.map((view) => (
          <Link
            key={view.href}
            href={view.href}
            className="view-nav-link"
            aria-current={pathname === view.href ? 'page' : undefined}
          >
            {view.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
