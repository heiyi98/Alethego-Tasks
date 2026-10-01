'use client';

import { Suspense } from 'react';

import { useSelection } from '@/components/selection';
import { TASK_VIEWS } from '@/views/registry';

/** 首页：按当前选择的看法（清单 / 责任分配矩阵）显示当前容器的任务 */
function CurrentView() {
  const { mode } = useSelection();
  const View = TASK_VIEWS[mode === 'matrix' ? 'list' : mode];
  return <View />;
}

export default function ListPage() {
  return (
    <Suspense>
      <CurrentView />
    </Suspense>
  );
}
