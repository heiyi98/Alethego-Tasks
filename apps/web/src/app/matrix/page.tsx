'use client';

import {
  QUADRANT_ORDER,
  buildMatrixLayout,
  groupPointsByQuadrant,
  matchesCategoryFilter,
  type Category,
} from '@alethego/core';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo } from 'react';

import { CategoryDot } from '@/components/category-dot';
import { usePanels } from '@/components/panel-provider';
import { useSelection } from '@/components/selection';
import { EditPanel } from '@/components/task-panels';
import { useTaskData } from '@/components/task-data-provider';
import { TaskMatrix } from '@/components/task-matrix';
import { PageHeader } from '@/components/task-list-view';
import { TaskRow } from '@/components/task-row';
import { QUADRANT_LABELS, STATUS_LABELS } from '@/lib/format';
import { rememberListUrl } from '@/lib/list-url';
import { MATRIX_STATUSES, selectionHref } from '@/lib/selection';

function MatrixPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data, error, now, timeZone } = useTaskData();
  const { active } = usePanels();
  const selection = useSelection();
  const { status, categoryIds } = selection;
  const query = searchParams.toString();
  useEffect(() => rememberListUrl(query ? `${pathname}?${query}` : pathname), [pathname, query]);

  // 已完成 / 已错过在矩阵上没有对应内容：自动切回清单
  const matrixStatus = MATRIX_STATUSES.includes(status);
  useEffect(() => {
    if (!matrixStatus) router.replace(selectionHref({ ...selection, mode: 'list' }));
  }, [matrixStatus, router, selection]);

  const categoriesById = useMemo(() => new Map(data?.categories.map((c) => [c.id, c])), [data]);
  const categoriesOf = (taskId: string): Category[] =>
    (data?.categoryIdsByTask.get(taskId) ?? [])
      .map((id) => categoriesById.get(id))
      .filter((c) => c !== undefined);

  // 左侧菜单的选择：分类命中其一即显示；"收藏"只显示标星任务；"全部""未完成"显示矩阵原本的任务
  const layout = useMemo(() => {
    if (!data) return null;
    const tasks = data.tasks.filter(
      (task) =>
        matchesCategoryFilter(data.categoryIdsByTask.get(task.id) ?? [], categoryIds) &&
        (status !== 'starred' || task.isStarred),
    );
    return buildMatrixLayout(
      { tasks, occurrencesByTask: data.occurrencesByTask },
      { now, timeZone },
    );
  }, [data, categoryIds, status, now, timeZone]);

  const groups = useMemo(() => (layout ? groupPointsByQuadrant(layout.points) : null), [layout]);

  const hiddenParts = layout
    ? [
        layout.hidden.unprocessed && `${layout.hidden.unprocessed} 个未设置重要性和截止时间`,
        layout.hidden.far_future && `${layout.hidden.far_future} 个截止时间超过一年`,
        layout.hidden.overdue_expired && `${layout.hidden.overdue_expired} 个逾期超过 3 天`,
      ].filter(Boolean)
    : [];

  return (
    <main className="page page-wide">
      {!matrixStatus && <p className="muted">正在切换到清单…</p>}
      <PageHeader
        title={STATUS_LABELS[status]}
        categories={categoryIds.map((id) => categoriesById.get(id)).filter((c) => c !== undefined)}
      />

      {error && <p className="notice notice-error">加载失败：{error}</p>}
      {!data && !error && <p className="muted">加载中…</p>}

      {matrixStatus && layout && groups && (
        <>
          <section className="matrix-card" aria-label="矩阵">
            <TaskMatrix
              points={layout.points}
              categoriesByTask={categoriesOf}
              now={now}
              timeZone={timeZone}
            />
            <div className="matrix-legend">
              <span className="task-category">
                <CategoryDot color="var(--viz-uncategorized)" />
                无分类
              </span>
              <span className="task-category">
                <span className="legend-overdue" aria-hidden />
                逾期（3 天内贴右侧显示）
              </span>
              <span className="muted">
                标题前的色标 = 所属分类，多分类按切片显示；点击任务可直接编辑
              </span>
            </div>
            {hiddenParts.length > 0 && (
              <p className="muted matrix-hidden" data-testid="matrix-hidden">
                另有 {hiddenParts.join('、')}，未显示在矩阵上，可在
                <Link href={selectionHref({ ...selection, mode: 'list' })}>清单</Link>
                中查看。
              </p>
            )}
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
