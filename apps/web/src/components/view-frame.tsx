'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { buildTaskList } from '@alethego/core';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';

import { useCurrentGroup } from './current-group';
import { usePanels } from './panel-provider';
import { QuickAdd } from './quick-add';
import { useSelection } from './selection';
import { useTaskData } from './task-data-provider';
import { EditPanel } from './task-panels';
import { TitleBar } from './title-bar';
import { STATUS_LABELS, statusOrderFor } from '@/lib/format';
import { groupHref, selectionHref } from '@/lib/selection';

/**
 * 清单类看法（清单、责任分配矩阵）共用的页面框架：标题行、添加栏、状态行，以及弹出的任务面板。
 * 页面顶部的高度是固定的，切换看法、进出组时标题和添加栏都在同一个位置。
 */
export function ViewFrame({ wide = false, children }: { wide?: boolean; children: ReactNode }) {
  const { data, error, actionError } = useTaskData();
  const selection = useSelection();
  const { groupId, projectId, scope, categoryIds } = selection;
  const router = useRouter();
  const { active, open } = usePanels();

  // 组不存在了（被删除）或者我不在这个组里：回到个人总览；项目没了（被删除、我被移出）：回到组页面
  const groupMissing = Boolean(groupId && data && !data.groups.some((g) => g.id === groupId));
  const projectMissing = Boolean(
    projectId && data && !groupMissing && !data.projects.some((p) => p.id === projectId),
  );
  useEffect(() => {
    if (groupMissing) router.replace('/', { scroll: false });
    else if (projectMissing && groupId)
      router.replace(groupHref(selection, groupId), { scroll: false });
  }, [groupMissing, projectMissing, groupId, selection, router]);

  // 从通知"查看"过来（?task=id）：在清单里原地展开这条任务的详情，滚动到屏幕中间，然后把参数去掉
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const taskParam = searchParams.get('task');
  const scrollTo = useRef<string | null>(null);
  useEffect(() => {
    if (!taskParam || !data) return;
    router.replace(selectionHref(selection), { scroll: false });
    if (!data.tasks.some((t) => t.id === taskParam)) return;
    scrollTo.current = taskParam;
    // 等页面切换完成后再展开（切换页面时面板会被收起）
    // （去掉地址参数会让这个 effect 重新执行，所以这里不清除定时器）
    setTimeout(() => open({ kind: 'edit', taskId: taskParam, surface: 'inline' }));
  }, [taskParam, data, open, router, selection, pathname]);
  useEffect(() => {
    const id = scrollTo.current;
    if (!id || active?.kind !== 'edit' || active.taskId !== id) return;
    scrollTo.current = null;
    let frames = 0;
    const tick = () => {
      const row = document.querySelector(`[data-task-row="${id}"]`);
      if (row) row.scrollIntoView({ block: 'center' });
      else if (frames++ < 30) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [active]);

  const selectedCategories = categoryIds
    .map((id) => data?.categories.find((c) => c.id === id))
    .filter((c) => c !== undefined);

  return (
    <main className={`page${wide ? ' page-wide' : ''}`}>
      <div className="page-top">
        <TitleBar />
        {groupId ? (
          <QuickAdd
            key={`${groupId}:${projectId ?? ''}`}
            categories={[]}
            starred={false}
            groupId={groupId}
            projectId={projectId}
          />
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

/**
 * 页面内的状态行（添加栏下面），单选：全部 / 未完成 / 已完成 / 已错过；
 * 开了任务分配的项目（组页面：有一个项目开了）是 全部 / 未完成 / 待确认 / 已完成 / 已错过，
 * "待确认"上的角标是当前待确认的任务数（0 时不显示）。
 */
function StatusBar() {
  const selection = useSelection();
  const router = useRouter();
  const { features } = useCurrentGroup();
  const { data, now, timeZone } = useTaskData();
  const pendingCount = useMemo(() => {
    if (!data || !features.confirmation || !selection.groupId) return 0;
    return buildTaskList(
      {
        tasks: data.tasks,
        categoryIdsByTask: data.categoryIdsByTask,
        occurrencesByTask: data.occurrencesByTask,
      },
      {
        status: 'pending',
        categoryIds: [],
        groupId: selection.groupId,
        projectId: selection.projectId,
      },
      { now, timeZone },
    ).length;
  }, [data, features.confirmation, selection.groupId, selection.projectId, now, timeZone]);
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
          {status === 'pending' && pendingCount > 0 && (
            <span className="status-badge" data-testid="pending-badge" aria-hidden>
              {pendingCount}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
