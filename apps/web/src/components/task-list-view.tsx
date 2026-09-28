'use client';

import {
  buildTaskList,
  categoryForQuickAdd,
  deriveListStatus,
  listDeadlineOf,
  type Category,
  type StatusFilter,
} from '@alethego/core';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef } from 'react';

import { CategoryDot } from './category-dot';
import { CategoryTags, StatusTags } from './filter-tags';
import { usePanels } from './panel-provider';
import { QuickAdd } from './quick-add';
import { useTaskData } from './task-data-provider';
import { TaskRow } from './task-row';
import { DEFAULT_STATUS, STATUS_LABELS, isStatusFilter } from '@/lib/format';
import { rememberListUrl } from '@/lib/list-url';

/**
 * 列表页主体，两种主导航共用：
 * - overview：状态由菜单决定，页面内用分类标签（多选）再筛选
 * - category：分类由菜单决定，页面内用状态标签再筛选
 * 两者都落到同一个 buildTaskList(状态, 分类) 上。
 */
export type TaskListMode =
  { kind: 'overview'; status: StatusFilter } | { kind: 'category'; category: Category };

export function TaskListView({ mode }: { mode: TaskListMode }) {
  const { data, error, actionError, now, timeZone, toggleComplete } = useTaskData();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();

  useEffect(() => rememberListUrl(query ? `${pathname}?${query}` : pathname), [pathname, query]);

  // 页面内的次级筛选保存在 URL 中，刷新或从详情返回后保持
  const status: StatusFilter =
    mode.kind === 'overview'
      ? mode.status
      : isStatusFilter(searchParams.get('status'))
        ? (searchParams.get('status') as StatusFilter)
        : DEFAULT_STATUS;

  const selectedTags = useMemo(() => {
    if (mode.kind === 'category') return [mode.category.id];
    const ids = searchParams.get('cat')?.split(',').filter(Boolean) ?? [];
    const existing = new Set(data?.categories.map((c) => c.id));
    return data ? ids.filter((id) => existing.has(id)) : ids;
  }, [mode, searchParams, data]);

  function replaceQuery(params: URLSearchParams) {
    const next = params.toString();
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }

  function toggleTag(categoryId: string) {
    const next = selectedTags.includes(categoryId)
      ? selectedTags.filter((id) => id !== categoryId)
      : [...selectedTags, categoryId];
    const params = new URLSearchParams();
    if (next.length > 0) params.set('cat', next.join(','));
    replaceQuery(params);
  }

  function setStatus(next: StatusFilter) {
    const params = new URLSearchParams();
    if (next !== DEFAULT_STATUS) params.set('status', next);
    replaceQuery(params);
  }

  const quickAddCategory =
    mode.kind === 'category'
      ? mode.category
      : (() => {
          const id = categoryForQuickAdd(selectedTags);
          return id ? (data?.categories.find((c) => c.id === id) ?? null) : null;
        })();

  const visibleTasks = useMemo(
    () =>
      data
        ? buildTaskList(
            {
              tasks: data.tasks,
              categoryIdsByTask: data.categoryIdsByTask,
              occurrencesByTask: data.occurrencesByTask,
            },
            { status, categoryIds: selectedTags },
            { now, timeZone },
          )
        : [],
    [data, status, selectedTags, now, timeZone],
  );

  // 正在编辑的任务即使改完后不再符合筛选（例如标记完成），也先留在原位，收起面板后再消失
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

  return (
    <main className="page">
      <header className="page-header">
        <h1>
          {mode.kind === 'category' && <CategoryDot color={mode.category.color} />}
          {mode.kind === 'overview' ? STATUS_LABELS[mode.status] : mode.category.name}
        </h1>
        {mode.kind === 'category' && mode.category.description && (
          <p className="page-description">{mode.category.description}</p>
        )}
      </header>

      <QuickAdd category={quickAddCategory} />

      <section className="filters" aria-label="筛选">
        {mode.kind === 'overview' ? (
          data && (
            <CategoryTags
              categories={data.categories}
              selected={selectedTags}
              onToggle={toggleTag}
            />
          )
        ) : (
          <StatusTags value={status} onChange={setStatus} />
        )}
      </section>

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
