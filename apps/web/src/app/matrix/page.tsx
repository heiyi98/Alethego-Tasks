'use client';

import {
  QUADRANT_ORDER,
  buildMatrixLayout,
  groupPointsByQuadrant,
  matchesCategoryFilter,
  matchesScope,
  type Category,
} from '@alethego/core';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo } from 'react';

import { usePanels } from '@/components/panel-provider';
import { useSelection } from '@/components/selection';
import { EditPanel } from '@/components/task-panels';
import { useTaskData } from '@/components/task-data-provider';
import { TaskMatrix } from '@/components/task-matrix';
import { PageHeader } from '@/components/task-list-view';
import { TaskRow } from '@/components/task-row';
import { QUADRANT_LABELS, SCOPE_LABELS } from '@/lib/format';
import { rememberListUrl } from '@/lib/list-url';

/**
 * 矩阵模式：没有添加栏和状态行，只受左侧范围（全部 / 收藏）和分类的选择影响。
 * 矩阵本身只显示未完成的任务（逾期 3 天内贴在最右格）。
 */
function MatrixPage() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data, error, now, timeZone } = useTaskData();
  const { active } = usePanels();
  const { scope, categoryIds } = useSelection();
  const query = searchParams.toString();
  useEffect(() => rememberListUrl(query ? `${pathname}?${query}` : pathname), [pathname, query]);

  const categoriesById = useMemo(() => new Map(data?.categories.map((c) => [c.id, c])), [data]);
  const categoriesOf = (taskId: string): Category[] =>
    (data?.categoryIdsByTask.get(taskId) ?? [])
      .map((id) => categoriesById.get(id))
      .filter((c) => c !== undefined);

  const layout = useMemo(() => {
    if (!data) return null;
    const tasks = data.tasks.filter(
      (task) =>
        matchesScope(task, scope) &&
        matchesCategoryFilter(data.categoryIdsByTask.get(task.id) ?? [], categoryIds),
    );
    return buildMatrixLayout(
      { tasks, occurrencesByTask: data.occurrencesByTask },
      { now, timeZone },
    );
  }, [data, categoryIds, scope, now, timeZone]);

  const groups = useMemo(() => (layout ? groupPointsByQuadrant(layout.points) : null), [layout]);

  return (
    <main className="page page-wide">
      <PageHeader
        title={SCOPE_LABELS[scope]}
        categories={categoryIds.map((id) => categoriesById.get(id)).filter((c) => c !== undefined)}
      />

      {error && <p className="notice notice-error">加载失败：{error}</p>}
      {!data && !error && <p className="muted">加载中…</p>}

      {layout && groups && (
        <>
          <section className="matrix-card" aria-label="矩阵">
            <TaskMatrix
              points={layout.points}
              categoriesByTask={categoriesOf}
              now={now}
              timeZone={timeZone}
            />
          </section>

          <section className="quadrant-lists" aria-label="象限列表">
            {QUADRANT_ORDER.map((quadrant) => (
              <section
                key={quadrant}
                className={`quadrant-list quadrant-${quadrant}`}
                aria-label={QUADRANT_LABELS[quadrant]}
              >
                <h2>
                  {QUADRANT_LABELS[quadrant]}
                  <span className="muted"> {groups[quadrant].length}</span>
                </h2>
                {groups[quadrant].length === 0 ? (
                  <p className="muted">暂无</p>
                ) : (
                  <ul className="task-list">
                    {groups[quadrant].map((point) => (
                      <TaskRow
                        key={point.task.id}
                        task={point.task}
                        categories={categoriesOf(point.task.id)}
                        now={now}
                        timeZone={timeZone}
                        deadline={point.representative.occurrenceAt ?? point.task.deadlineAt}
                      />
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </section>
        </>
      )}

      {/* 矩阵上点击任务：原页面上弹出编辑面板（手机为底部抽屉），不跳转 */}
      {active?.kind === 'edit' && active.surface === 'floating' && (
        <EditPanel key={active.taskId} taskId={active.taskId} surface="floating" />
      )}
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <MatrixPage />
    </Suspense>
  );
}
