'use client';

import type { DataStore } from '@alethego/data';
import { createContext, useContext, useState, type ReactNode } from 'react';

import { createBrowserRepositories } from '@/lib/repositories';

const RepositoriesContext = createContext<DataStore | null>(null);

export function RepositoriesProvider({ children }: { children: ReactNode }) {
  const [repositories] = useState(createBrowserRepositories);

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
