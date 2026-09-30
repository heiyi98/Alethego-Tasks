import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AuthProvider } from '@/auth';
import { AppShell } from '@/components/app-shell';
import { FeedbackProvider } from '@/components/feedback-provider';
import { PanelProvider } from '@/components/panel-provider';
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
        {/* 没登录时只显示登录页；登录后任务界面按当前账号取数据 */}
        <AuthProvider>
          <RepositoriesProvider>
            <TaskDataProvider>
              <FeedbackProvider>
                <PanelProvider>
                  <AppShell>{children}</AppShell>
                </PanelProvider>
              </FeedbackProvider>
            </TaskDataProvider>
          </RepositoriesProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
