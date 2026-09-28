'use client';

import {
  DEFAULT_MATRIX_MODE,
  QUADRANT_ORDER,
  buildMatrixLayout,
  groupPointsByQuadrant,
  matchesCategoryFilter,
  matchesScope,
  type Category,
  type MatrixMode,
} from '@alethego/core';
import { Suspense, useEffect, useMemo, useState } from 'react';

import { CalendarIcon, ClockIcon, IconButton } from '@/components/icons';
import { usePanels } from '@/components/panel-provider';
import { useSelection } from '@/components/selection';
import { EditPanel } from '@/components/task-panels';
import { useTaskData } from '@/components/task-data-provider';
import { TaskMatrix } from '@/components/task-matrix';
import { TaskRow } from '@/components/task-row';
import { TitleBar } from '@/components/title-bar';
import { QUADRANT_LABELS } from '@/lib/format';

/** 记住上次看的是短期还是长期（只是本机的便利设置，读不到就用默认的短期） */
const MODE_STORAGE_KEY = 'alethego.matrix-mode';

function readStoredMode(): MatrixMode | null {
  try {
    const value = window.localStorage.getItem(MODE_STORAGE_KEY);
    return value === 'short' || value === 'long' ? value : null;
  } catch {
    return null;
  }
}

function storeMode(mode: MatrixMode) {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // 存不了就算了
  }
}

/**
 * 矩阵模式：没有添加栏和状态行，只受左侧范围（总览 / 收藏）和分类的选择影响。
 * 矩阵本身只显示未完成的任务（逾期 3 天内在最右边的逾期区）。
 * 右上方的图标按钮在"短期""长期"之间切换；四象限清单按当前模式判定紧急与否，清单里有哪些任务与模式无关。
 */
function MatrixPage() {
  const { data, error, now, timeZone, toggleComplete } = useTaskData();
  const { active } = usePanels();
  const { scope, categoryIds } = useSelection();
  const [mode, setMode] = useState<MatrixMode>(DEFAULT_MATRIX_MODE);
  useEffect(() => {
    const stored = readStoredMode();
    if (stored) setMode(stored);
  }, []);
  const switchMode = () => {
    const next: MatrixMode = mode === 'short' ? 'long' : 'short';
    setMode(next);
    storeMode(next);
  };

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
      mode,
    );
  }, [data, categoryIds, scope, now, timeZone, mode]);

  const groups = useMemo(() => (layout ? groupPointsByQuadrant(layout.points) : null), [layout]);

  return (
    <main className="page page-wide">
      <TitleBar />

      {error && <p className="notice notice-error">加载失败：{error}</p>}
      {!data && !error && <p className="muted">加载中…</p>}

      {layout && groups && (
        <>
          <section className="matrix-card" aria-label="矩阵" data-mode={mode}>
            <IconButton
              label={mode === 'short' ? '切换到长期' : '切换到短期'}
              className="matrix-mode-toggle"
              onClick={switchMode}
            >
              {/* 图标表示当前模式：短期是时钟，长期是日历 */}
              {mode === 'short' ? <ClockIcon /> : <CalendarIcon />}
            </IconButton>
            <TaskMatrix
              points={layout.points}
              mode={mode}
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
                        onToggleComplete={toggleComplete}
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
