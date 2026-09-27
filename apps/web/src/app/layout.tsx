import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AppShell } from '@/components/app-shell';
import { RepositoriesProvider } from '@/components/repositories-provider';
import { TaskDataProvider } from '@/components/task-data-provider';

import './globals.css';

export const metadata: Metadata = {
  title: 'Alethego Tasks',
  description: '内置时间管理矩阵的任务管理工具',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <RepositoriesProvider>
          <TaskDataProvider>
            <AppShell>{children}</AppShell>
          </TaskDataProvider>
        </RepositoriesProvider>
      </body>
    </html>
  );
}
