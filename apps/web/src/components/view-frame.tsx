'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { useCurrentGroup } from './current-group';
import { usePanels } from './panel-provider';
import { QuickAdd } from './quick-add';
import { useSelection } from './selection';
import { useTaskData } from './task-data-provider';
import { EditPanel } from './task-panels';
import { TitleBar } from './title-bar';
import { STATUS_LABELS, statusOrderFor } from '@/lib/format';
import { selectionHref } from '@/lib/selection';

/**
 * 清单类看法（清单、责任分配矩阵）共用的页面框架：标题行、添加栏、状态行，以及弹出的任务面板。
 * 页面顶部的高度是固定的，切换看法、进出组时标题和添加栏都在同一个位置。
 */
export function ViewFrame({ wide = false, children }: { wide?: boolean; children: ReactNode }) {
  const { data, error, actionError } = useTaskData();
  const selection = useSelection();
  const { groupId, scope, categoryIds } = selection;
  const router = useRouter();
  const { active, open } = usePanels();

  // 组不存在了（被删除）或者我不在这个组里：回到个人总览
  const groupMissing = Boolean(groupId && data && !data.groups.some((g) => g.id === groupId));
  useEffect(() => {
    if (groupMissing) router.replace('/', { scroll: false });
  }, [groupMissing, router]);

  // 从通知"查看"过来（?task=id）：打开这条任务的详情，然后把参数去掉
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const taskParam = searchParams.get('task');
  useEffect(() => {
    if (!taskParam || !data) return;
    if (data.tasks.some((t) => t.id === taskParam)) {
      open({ kind: 'edit', taskId: taskParam, surface: 'floating' });
    }
    router.replace(selectionHref(selection), { scroll: false });
  }, [taskParam, data, open, router, selection, pathname]);

  const selectedCategories = categoryIds
    .map((id) => data?.categories.find((c) => c.id === id))
    .filter((c) => c !== undefined);

  return (
    <main className={`page${wide ? ' page-wide' : ''}`}>
      <div className="page-top">
        <TitleBar />
        {groupId ? (
          <QuickAdd key={groupId} categories={[]} starred={false} groupId={groupId} />
        ) : (
          <QuickAdd categories={selectedCategories} starred={scope === 'starred'} />
        )}
      </div>

      <StatusBar />

      {(error ?? actionError) && (
        <p className="notice notice-error">操作失败：{error ?? actionError}</p>
      )}
      {!data && !error && <p className="muted">加载中…</p>}

      {data && children}

      {active?.kind === 'edit' && active.surface === 'floating' && (
        <EditPanel key={active.taskId} taskId={active.taskId} surface="floating" />
      )}
    </main>
  );
}

/** 页面内的状态行（添加栏下面）：全部 / 未完成 / 已完成 / 已错过，管理组多一个待确认；单选 */
function StatusBar() {
  const selection = useSelection();
  const router = useRouter();
  const { features } = useCurrentGroup();
  return (
    <div className="segmented-control status-bar" role="group" aria-label="状态">
      {statusOrderFor(features).map((status) => (
        <button
          key={status}
          type="button"
          aria-pressed={selection.status === status}
          onClick={() => router.replace(selectionHref({ ...selection, status }), { scroll: false })}
        >
          {STATUS_LABELS[status]}
        </button>
      ))}
    </div>
  );
}
