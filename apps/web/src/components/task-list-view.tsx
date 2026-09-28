'use client';

import { buildTaskList, deriveListStatus, listDeadlineOf } from '@alethego/core';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef } from 'react';

import { CategoryDot } from './category-dot';
import { usePanels } from './panel-provider';
import { QuickAdd } from './quick-add';
import { useSelection } from './selection';
import { useTaskData } from './task-data-provider';
import { TaskRow } from './task-row';
import { STATUS_LABELS } from '@/lib/format';
import { rememberListUrl } from '@/lib/list-url';

/**
 * 清单模式：内容 = 左侧菜单所选状态 ∩（命中任一所选分类）。页面内没有任何筛选标签。
 * 快速添加只出现在"全部"里。
 */
export function TaskListView() {
  const { data, error, actionError, now, timeZone, toggleComplete } = useTaskData();
  const selection = useSelection();
  const { status, categoryIds } = selection;
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
            { status, categoryIds },
            { now, timeZone },
          )
        : [],
    [data, status, categoryIds, now, timeZone],
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
      <PageHeader title={STATUS_LABELS[status]} categories={selectedCategories} />

      {status === 'all' && <QuickAdd categories={selectedCategories} />}

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

/**
 * 页面标题：所选状态；下方以纯文字说明所选分类（不是可点的标签），
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
