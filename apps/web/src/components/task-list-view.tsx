'use client';

import { buildTaskList, deriveListStatus, listDeadlineOf } from '@alethego/core';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef } from 'react';

import { CategoryDot } from './category-dot';
import { usePanels } from './panel-provider';
import { QuickAdd } from './quick-add';
import { useSelection } from './selection';
import { useTaskData } from './task-data-provider';
import { TaskRow } from './task-row';
import { SCOPE_LABELS, STATUS_LABELS, STATUS_ORDER } from '@/lib/format';
import { rememberListUrl } from '@/lib/list-url';
import { selectionHref } from '@/lib/selection';

/**
 * 清单模式：内容 = 所选范围（全部 / 收藏）∩ 所选分类的并集 ∩ 所选状态。
 * 添加栏每个页面都有；状态行在添加栏下面。
 * 当前状态是"已完成""已错过"时新建的任务看不见是正常的，不做自动切换。
 */
export function TaskListView() {
  const { data, error, actionError, now, timeZone, toggleComplete } = useTaskData();
  const selection = useSelection();
  const { scope, status, categoryIds } = selection;
  const pathname = usePathname();
  const query = useSearchParams().toString();

  useEffect(() => rememberListUrl(query ? `${pathname}?${query}` : pathname), [pathname, query]);

  const visibleTasks = useMemo(
    () =>
      data
        ? buildTaskList(
            {
              tasks: data.tasks,
              categoryIdsByTask: data.categoryIdsByTask,
              occurrencesByTask: data.occurrencesByTask,
            },
            { scope, status, categoryIds },
            { now, timeZone },
          )
        : [],
    [data, scope, status, categoryIds, now, timeZone],
  );

  // 正在编辑的任务即使改完后不再符合筛选（例如标记完成、取消标星），也先留在原位，收起面板后再消失
  const { active } = usePanels();
  const openTaskId = active?.kind === 'edit' && active.surface === 'inline' ? active.taskId : null;
  const lastOrder = useRef<string[]>([]);
  const shownTasks = useMemo(() => {
    const list = [...visibleTasks];
    const openTask = openTaskId ? data?.tasks.find((t) => t.id === openTaskId) : undefined;
    if (openTask && !list.some((t) => t.id === openTask.id)) {
      const index = lastOrder.current.indexOf(openTask.id);
      list.splice(index < 0 ? list.length : Math.min(index, list.length), 0, openTask);
    }
    return list;
  }, [visibleTasks, openTaskId, data]);
  useEffect(() => {
    lastOrder.current = shownTasks.map((t) => t.id);
  }, [shownTasks]);

  const categoriesById = useMemo(() => new Map(data?.categories.map((c) => [c.id, c])), [data]);
  const selectedCategories = categoryIds
    .map((id) => categoriesById.get(id))
    .filter((c) => c !== undefined);

  return (
    <main className="page">
      <PageHeader title={SCOPE_LABELS[scope]} categories={selectedCategories} />

      <QuickAdd categories={selectedCategories} starred={scope === 'starred'} />

      <StatusBar />

      {(error ?? actionError) && (
        <p className="notice notice-error">操作失败：{error ?? actionError}</p>
      )}

      {!data && !error && <p className="muted">加载中…</p>}

      {data && shownTasks.length === 0 && (
        <p className="muted empty">没有{status === 'all' ? '' : STATUS_LABELS[status]}任务</p>
      )}

      {data && shownTasks.length > 0 && (
        <ul className="task-list" aria-label="任务列表">
          {shownTasks.map((task) => {
            const occurrences = data.occurrencesByTask.get(task.id) ?? [];
            return (
              <TaskRow
                key={task.id}
                task={task}
                categories={(data.categoryIdsByTask.get(task.id) ?? [])
                  .map((id) => categoriesById.get(id))
                  .filter((c) => c !== undefined)}
                now={now}
                timeZone={timeZone}
                onToggleComplete={toggleComplete}
                deadline={listDeadlineOf(task, occurrences, { now, timeZone })}
                status={deriveListStatus(task, occurrences, { now, timeZone })}
              />
            );
          })}
        </ul>
      )}
    </main>
  );
}

/** 页面内的状态行（添加栏下面）：全部 / 未完成 / 已完成 / 已错过，单选 */
function StatusBar() {
  const selection = useSelection();
  const router = useRouter();
  return (
    <div className="segmented-control status-bar" role="group" aria-label="状态">
      {STATUS_ORDER.map((status) => (
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

/**
 * 页面标题：所选范围；下方以纯文字说明所选分类（不是可点的标签），
 * 只选了一个分类且它有描述时一并显示描述。
 */
export function PageHeader({
  title,
  categories,
}: {
  title: string;
  categories: readonly { id: string; name: string; color: string; description: string }[];
}) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      {categories.length > 0 && (
        <p className="page-scope" data-testid="page-scope">
          {categories.map((category) => (
            <span key={category.id} className="page-scope-item">
              <CategoryDot color={category.color} />
              {category.name}
            </span>
          ))}
        </p>
      )}
      {categories.length === 1 && categories[0]!.description && (
        <p className="page-description">{categories[0]!.description}</p>
      )}
    </header>
  );
}
