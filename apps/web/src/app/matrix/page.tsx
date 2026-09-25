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
import { Suspense, useMemo, useState } from 'react';

import { CategoryDot } from '@/components/category-dot';
import { CategoryFilterBar } from '@/components/list-filters';
import { TaskMatrix } from '@/components/task-matrix';
import { TaskRow } from '@/components/task-row';
import { ViewNav } from '@/components/view-nav';
import { useNow } from '@/hooks/use-now';
import { useTaskListData } from '@/hooks/use-task-list-data';
import { QUADRANT_LABELS, browserTimeZone } from '@/lib/format';

function MatrixPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data, error } = useTaskListData();
  const now = useNow();
  const [timeZone] = useState(browserTimeZone);

  const selectedCategoryIds = useMemo(() => {
    const ids = searchParams.get('cat')?.split(',').filter(Boolean) ?? [];
    const existing = new Set(data?.categories.map((c) => c.id));
    return data ? ids.filter((id) => existing.has(id)) : ids;
  }, [searchParams, data]);

  function toggleCategory(categoryId: string) {
    const next = selectedCategoryIds.includes(categoryId)
      ? selectedCategoryIds.filter((id) => id !== categoryId)
      : [...selectedCategoryIds, categoryId];
    router.replace(next.length > 0 ? `${pathname}?cat=${next.join(',')}` : pathname, {
      scroll: false,
    });
  }

  const categoriesById = useMemo(() => new Map(data?.categories.map((c) => [c.id, c])), [data]);
  const categoriesOf = (taskId: string): Category[] =>
    (data?.categoryIdsByTask.get(taskId) ?? [])
      .map((id) => categoriesById.get(id))
      .filter((c) => c !== undefined);

  // 分类多选点亮：命中其一即显示；命中的圆点仍按全部分类切片
  const layout = useMemo(() => {
    if (!data) return null;
    const tasks = data.tasks.filter((task) =>
      matchesCategoryFilter(data.categoryIdsByTask.get(task.id) ?? [], selectedCategoryIds),
    );
    return buildMatrixLayout(
      { tasks, occurrencesByTask: data.occurrencesByTask },
      { now, timeZone },
    );
  }, [data, selectedCategoryIds, now, timeZone]);

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
      <ViewNav title="时间管理矩阵" />

      {data && data.categories.length > 0 && (
        <section className="filters" aria-label="筛选">
          <CategoryFilterBar
            categories={data.categories}
            selected={selectedCategoryIds}
            onToggle={toggleCategory}
          />
        </section>
      )}

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
            <div className="matrix-legend">
              <span className="task-category">
                <CategoryDot color="var(--viz-uncategorized)" />
                无分类
              </span>
              <span className="task-category">
                <span className="legend-overdue" aria-hidden />
                逾期（3 天内贴右侧显示）
              </span>
              <span className="muted">圆点颜色 = 所属分类，多分类按切片显示；点击圆点查看详情</span>
            </div>
            {hiddenParts.length > 0 && (
              <p className="muted matrix-hidden" data-testid="matrix-hidden">
                另有 {hiddenParts.join('、')}，未显示在矩阵上，可在<Link href="/">列表</Link>
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
