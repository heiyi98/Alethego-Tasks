'use client';

import { useParams } from 'next/navigation';
import { Suspense } from 'react';

import { useTaskData } from '@/components/task-data-provider';
import { TaskListView } from '@/components/task-list-view';

/** 分类：以分类为主导航，页面内用状态标签筛选 */
export default function CategoryPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = useTaskData();
  const category = data?.categories.find((c) => c.id === id);

  if (!category) {
    return (
      <main className="page">
        <p className="muted">{error ? `加载失败：${error}` : data ? '分类不存在。' : '加载中…'}</p>
      </main>
    );
  }
  return (
    <Suspense>
      <TaskListView key={category.id} mode={{ kind: 'category', category }} />
    </Suspense>
  );
}
