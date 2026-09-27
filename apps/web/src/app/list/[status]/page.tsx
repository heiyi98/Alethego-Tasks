'use client';

import { useParams } from 'next/navigation';
import { Suspense } from 'react';

import { TaskListView } from '@/components/task-list-view';
import { isStatusFilter } from '@/lib/format';

/** 总览：以状态为主导航（全部 / 未完成 / 已完成 / 已错过），页面内用分类标签筛选 */
export default function OverviewPage() {
  const { status } = useParams<{ status: string }>();
  if (!isStatusFilter(status)) {
    return (
      <main className="page">
        <p className="muted">页面不存在。</p>
      </main>
    );
  }
  return (
    <Suspense>
      <TaskListView mode={{ kind: 'overview', status }} />
    </Suspense>
  );
}
