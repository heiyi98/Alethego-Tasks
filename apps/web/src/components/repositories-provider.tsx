'use client';

import type { DataStore } from '@alethego/data';
import { createContext, useContext, useState, type ReactNode } from 'react';

import { useCurrentUser } from '@/auth';
import { createBrowserRepositories } from '@/lib/repositories';

const RepositoriesContext = createContext<DataStore | null>(null);

export function RepositoriesProvider({ children }: { children: ReactNode }) {
  // 数据归属当前登录用户；换账号时整棵界面重新挂载，这里随之重建
  const user = useCurrentUser();
  const [repositories] = useState(() => createBrowserRepositories(user));

  if (!repositories) {
    return (
      <main className="page">
        <div className="notice notice-error">
          <p>尚未配置 Supabase。</p>
          <p>
            请在 <code>apps/web/.env.local</code> 中设置 <code>NEXT_PUBLIC_SUPABASE_URL</code> 与{' '}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>（参考 <code>.env.example</code>）。
          </p>
        </div>
      </main>
    );
  }

  return (
    <RepositoriesContext.Provider value={repositories}>{children}</RepositoriesContext.Provider>
  );
}

export function useRepositories(): DataStore {
  const repositories = useContext(RepositoriesContext);
  if (!repositories) throw new Error('useRepositories 必须在 RepositoriesProvider 内使用');
  return repositories;
}
