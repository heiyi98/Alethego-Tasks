'use client';

import {
  DEFAULT_STATUS_FILTER,
  STATUS_FILTERS,
  buildTaskList,
  type StatusFilter,
  type Task,
} from '@alethego/core';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';

import { CategoryFilterBar, StatusFilterBar } from '@/components/list-filters';
import { QuickAdd } from '@/components/quick-add';
import { useRepositories } from '@/components/repositories-provider';
import { TaskRow } from '@/components/task-row';
import { useNow } from '@/hooks/use-now';
import { useTaskListData } from '@/hooks/use-task-list-data';
import { STATUS_LABELS, browserTimeZone, errorMessage } from '@/lib/format';
import { rememberListUrl } from '@/lib/list-url';

function parseStatus(value: string | null): StatusFilter {
  return STATUS_FILTERS.find((status) => status === value) ?? DEFAULT_STATUS_FILTER;
}

function TaskListPage() {
  const repositories = useRepositories();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data, error, reload, replaceTask } = useTaskListData();
  const now = useNow();
  const [timeZone] = useState(browserTimeZone);
  const [actionError, setActionError] = useState<string | null>(null);

  // 筛选条件保存在 URL 中，从详情页返回时保持不变
  const status = parseStatus(searchParams.get('status'));
  const selectedCategoryIds = useMemo(() => {
    const ids = searchParams.get('cat')?.split(',').filter(Boolean) ?? [];
    const existing = new Set(data?.categories.map((c) => c.id));
    return data ? ids.filter((id) => existing.has(id)) : ids;
  }, [searchParams, data]);

  const query = searchParams.toString();
  useEffect(() => rememberListUrl(query ? `${pathname}?${query}` : pathname), [pathname, query]);

  function setFilter(next: { status?: StatusFilter; categoryIds?: readonly string[] }) {
    const params = new URLSearchParams();
    const nextStatus = next.status ?? status;
    const nextCategories = next.categoryIds ?? selectedCategoryIds;
    if (nextStatus !== DEFAULT_STATUS_FILTER) params.set('status', nextStatus);
    if (nextCategories.length > 0) params.set('cat', nextCategories.join(','));
    const nextQuery = params.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }

  function toggleCategory(categoryId: string) {
    setFilter({
      categoryIds: selectedCategoryIds.includes(categoryId)
        ? selectedCategoryIds.filter((id) => id !== categoryId)
        : [...selectedCategoryIds, categoryId],
    });
  }

  async function toggleComplete(task: Task) {
    const completedAt = task.completedAt ? null : new Date();
    replaceTask({ ...task, completedAt }); // 乐观更新，勾选立即生效
    try {
      replaceTask(await repositories.tasks.update(task.id, { completedAt }));
      setActionError(null);
    } catch (e) {
      setActionError(errorMessage(e));
      await reload();
    }
  }

  const visibleTasks = useMemo(
    () =>
      data
        ? buildTaskList(
            { tasks: data.tasks, categoryIdsByTask: data.categoryIdsByTask },
            { status, categoryIds: selectedCategoryIds },
            { now, timeZone },
          )
        : [],
    [data, status, selectedCategoryIds, now, timeZone],
  );

  const categoriesById = useMemo(() => new Map(data?.categories.map((c) => [c.id, c])), [data]);

  return (
    <main className="page">
      <header className="page-header">
        <h1>任务</h1>
      </header>

      <QuickAdd onCreated={reload} />

      <section className="filters" aria-label="筛选">
        <StatusFilterBar value={status} onChange={(next) => setFilter({ status: next })} />
        {data && (
          <CategoryFilterBar
            categories={data.categories}
            selected={selectedCategoryIds}
            onToggle={toggleCategory}
            onCreated={reload}
          />
        )}
      </section>

      {(error ?? actionError) && (
        <p className="notice notice-error">操作失败：{error ?? actionError}</p>
      )}

      {!data && !error && <p className="muted">加载中…</p>}

      {data && visibleTasks.length === 0 && (
        <p className="muted empty">没有{status === 'all' ? '' : STATUS_LABELS[status]}任务</p>
      )}

      {data && visibleTasks.length > 0 && (
        <ul className="task-list" aria-label="任务列表">
          {visibleTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              categories={(data.categoryIdsByTask.get(task.id) ?? [])
                .map((id) => categoriesById.get(id))
                .filter((c) => c !== undefined)}
              now={now}
              timeZone={timeZone}
              onToggleComplete={toggleComplete}
            />
          ))}
        </ul>
      )}
    </main>
  );
}

export default function HomePage() {
  return (
    <Suspense>
      <TaskListPage />
    </Suspense>
  );
}
