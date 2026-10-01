'use client';

import { deriveListStatus, listDeadlineOf } from '@alethego/core';
import { useMemo } from 'react';

import { useSelection } from '@/components/selection';
import { useTaskData } from '@/components/task-data-provider';
import { TaskRow } from '@/components/task-row';
import { ViewFrame } from '@/components/view-frame';
import { useVisibleTasks } from '@/hooks/use-visible-tasks';
import { STATUS_LABELS } from '@/lib/format';

/**
 * 清单：内容 = 当前容器 ∩ 所选范围（全部 / 收藏）∩ 所选分类的并集 ∩ 所选状态。
 * 当前状态是"已完成""已错过"时新建的任务看不见是正常的，不做自动切换。
 */
export function ListView() {
  return (
    <ViewFrame>
      <TaskList />
    </ViewFrame>
  );
}

function TaskList() {
  const { data, now, timeZone, toggleComplete } = useTaskData();
  const { status } = useSelection();
  const tasks = useVisibleTasks();
  const categoriesById = useMemo(() => new Map(data?.categories.map((c) => [c.id, c])), [data]);

  if (!data) return null;
  if (tasks.length === 0) {
    return <p className="muted empty">没有{status === 'all' ? '' : STATUS_LABELS[status]}任务</p>;
  }
  return (
    <ul className="task-list" aria-label="任务列表">
      {tasks.map((task) => {
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
  );
}
