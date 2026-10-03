'use client';

import { Suspense } from 'react';

import { useCurrentGroup } from '@/components/current-group';
import { useSelection } from '@/components/selection';
import { TASK_VIEWS } from '@/views/registry';

/** 首页：按当前选择的看法（清单 / 责任分配矩阵 / 甘特图）显示当前容器的任务；当前容器没有这种看法时显示清单 */
function CurrentView() {
  const { mode } = useSelection();
  const { features } = useCurrentGroup();
  const View = TASK_VIEWS[mode === 'matrix' || !features.views.includes(mode) ? 'list' : mode];
  return <View />;
}

export default function ListPage() {
  return (
    <Suspense>
      <CurrentView />
    </Suspense>
  );
}
