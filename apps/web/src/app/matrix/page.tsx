'use client';

import {
  DEFAULT_MATRIX_MODE,
  QUADRANT_ORDER,
  buildMatrixLayout,
  groupPointsByQuadrant,
  matrixFilterIncludes,
  type Category,
  type MatrixMode,
} from '@alethego/core';
import { Suspense, useEffect, useMemo, useState } from 'react';

import { useCurrentUser } from '@/auth';
import { useMatrixFilter } from '@/components/matrix-filter';
import { usePanels } from '@/components/panel-provider';
import { EditPanel } from '@/components/task-panels';
import { useTaskData } from '@/components/task-data-provider';
import { TaskMatrix } from '@/components/task-matrix';
import { TaskRow } from '@/components/task-row';
import { QUADRANT_LABELS } from '@/lib/format';
import { relatedGroupTaskPredicate } from '@/lib/related';

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
 * 矩阵模式：没有标题、添加栏和状态行；显示左边筛选栏所有勾选内容的并集
 * （个人任务或所选分类的任务，所选项目里和我有关的组任务）。
 * 矩阵本身只显示未完成的任务（逾期 3 天内在最右边的逾期区）。
 * 矩阵上方的文字胶囊显示当前模式（"短期"或"长期"），点击切换到另一个；四象限清单按当前模式判定紧急与否，清单里有哪些任务与模式无关。
 */
function MatrixPage() {
  const { data, error, now, timeZone, toggleComplete } = useTaskData();
  const { active } = usePanels();
  const user = useCurrentUser();
  const { filter, loaded } = useMatrixFilter();
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
  const projectsById = useMemo(() => new Map(data?.projects.map((p) => [p.id, p])), [data]);
  // 圆点的颜色：个人任务用分类的颜色；组任务用项目的颜色
  const categoriesOf = (taskId: string): Category[] => {
    const task = data?.tasks.find((t) => t.id === taskId);
    const project = task?.projectId ? projectsById.get(task.projectId) : undefined;
    if (project) {
      return [
        {
          id: project.id,
          ownerId: '',
          name: project.name,
          color: project.color,
          description: '',
          tools: [],
          createdAt: project.createdAt,
        } as Category,
      ];
    }
    return (data?.categoryIdsByTask.get(taskId) ?? [])
      .map((id) => categoriesById.get(id))
      .filter((c) => c !== undefined);
  };

  const layout = useMemo(() => {
    if (!data || !loaded) return null;
    const isRelated = relatedGroupTaskPredicate(data, user.id);
    const tasks = data.tasks.filter((task) =>
      matrixFilterIncludes(task, filter, {
        categoryIdsOf: (id) => data.categoryIdsByTask.get(id) ?? [],
        isRelatedGroupTask: isRelated,
      }),
    );
    return buildMatrixLayout(
      { tasks, occurrencesByTask: data.occurrencesByTask },
      { now, timeZone },
      mode,
    );
  }, [data, loaded, filter, user.id, now, timeZone, mode]);

  const groups = useMemo(() => (layout ? groupPointsByQuadrant(layout.points) : null), [layout]);

  return (
    <main className="page page-wide">
      {error && <p className="notice notice-error">加载失败：{error}</p>}
      {!data && !error && <p className="muted">加载中…</p>}

      {layout && groups && (
        <>
          {/* 短期 / 长期：矩阵上方单独一行的文字胶囊，显示当前模式，点击切换到另一个 */}
          <div className="matrix-toolbar">
            <button type="button" className="chip matrix-mode" onClick={switchMode}>
              {mode === 'short' ? '短期' : '长期'}
            </button>
          </div>
          <section className="matrix-card" aria-label="矩阵" data-mode={mode}>
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
