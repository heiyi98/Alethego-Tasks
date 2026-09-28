'use client';

import { Suspense } from 'react';

import { TaskListView } from '@/components/task-list-view';

/** 清单模式：内容由左侧菜单的选择（状态 + 分类）决定 */
export default function ListPage() {
  return (
    <Suspense>
      <TaskListView />
    </Suspense>
  );
}
