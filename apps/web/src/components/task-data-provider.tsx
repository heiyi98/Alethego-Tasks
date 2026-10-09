'use client';

import { subtasksFor, type Subtask, type Task } from '@alethego/core';
import { completeCurrentOccurrence } from '@alethego/data';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { useRepositories } from './repositories-provider';
import { useNow } from '@/hooks/use-now';
import { useTaskListData, type TaskListData } from '@/hooks/use-task-list-data';
import { browserTimeZone, errorMessage } from '@/lib/format';

/**
 * 全局任务数据：侧边栏（计数）与各列表 / 矩阵页共享同一份数据和同一套筛选逻辑。
 * 路由变化时重新加载，面板改动后计数与列表都是最新的。
 */

interface TaskDataValue {
  data: TaskListData | null;
  error: string | null;
  now: Date;
  timeZone: string;
  reload: () => Promise<void>;
  /** 勾选完成：普通任务切换自身完成状态；循环任务完成当前代表实例 */
  toggleComplete: (task: Task) => Promise<void>;
  /** 勾选 / 取消一个子任务；循环任务给出是哪一次，普通任务为 null（不发通知） */
  toggleSubtask: (subtask: Subtask, occurrenceDate: Date | null, checked: boolean) => Promise<void>;
  /** 切换标星（书签） */
  toggleStar: (task: Task) => Promise<void>;
  actionError: string | null;
}

const TaskDataContext = createContext<TaskDataValue | null>(null);

export function TaskDataProvider({ children }: { children: ReactNode }) {
  const repositories = useRepositories();
  const pathname = usePathname();
  const { data, error, reload, replaceTask, upsertOccurrence, setSubtaskCheck } = useTaskListData();

  /** 父任务（或循环任务的这一次）勾完成时，没勾的子任务一起勾上（数据库同样处理） */
  const checkAllSubtasks = (task: Task, occurrenceDate: Date | null) => {
    for (const subtask of subtasksFor(data?.subtasksByTask.get(task.id) ?? [], occurrenceDate)) {
      setSubtaskCheck(subtask.id, occurrenceDate, true);
    }
  };
  const now = useNow();
  const [timeZone] = useState(browserTimeZone);
  const [actionError, setActionError] = useState<string | null>(null);

  // 首次加载由 useTaskListData 完成；之后每次切换页面刷新一次
  const [lastPath, setLastPath] = useState(pathname);
  useEffect(() => {
    if (pathname === lastPath) return;
    setLastPath(pathname);
    void reload();
  }, [pathname, lastPath, reload]);

  async function toggleComplete(task: Task) {
    if (task.recurrenceRule) {
      try {
        const done = await completeCurrentOccurrence(
          repositories.occurrences,
          task,
          data?.occurrencesByTask.get(task.id) ?? [],
          { now: new Date(), timeZone },
        );
        if (done) {
          upsertOccurrence(done);
          checkAllSubtasks(task, done.occurrenceDate);
        }
        setActionError(null);
      } catch (e) {
        setActionError(errorMessage(e));
        await reload();
      }
      return;
    }
    const completedAt = task.completedAt ? null : new Date();
    replaceTask({ ...task, completedAt }); // 乐观更新，勾选立即生效
    try {
      replaceTask(await repositories.tasks.update(task.id, { completedAt }));
      if (completedAt) checkAllSubtasks(task, null);
      setActionError(null);
    } catch (e) {
      setActionError(errorMessage(e));
      await reload();
    }
  }

  async function toggleSubtask(subtask: Subtask, occurrenceDate: Date | null, checked: boolean) {
    setSubtaskCheck(subtask.id, occurrenceDate, checked); // 乐观更新
    try {
      await repositories.subtasks.setChecked(subtask.id, occurrenceDate, checked);
      setActionError(null);
    } catch (e) {
      setActionError(errorMessage(e));
      await reload();
    }
  }

  async function toggleStar(task: Task) {
    const isStarred = !task.isStarred;
    replaceTask({ ...task, isStarred }); // 乐观更新
    try {
      replaceTask(await repositories.tasks.update(task.id, { isStarred }));
      setActionError(null);
    } catch (e) {
      setActionError(errorMessage(e));
      await reload();
    }
  }

  return (
    <TaskDataContext.Provider
      value={{
        data,
        error,
        now,
        timeZone,
        reload,
        toggleComplete,
        toggleSubtask,
        toggleStar,
        actionError,
      }}
    >
      {children}
    </TaskDataContext.Provider>
  );
}

export function useTaskData(): TaskDataValue {
  const value = useContext(TaskDataContext);
  if (!value) throw new Error('useTaskData 必须在 TaskDataProvider 内使用');
  return value;
}
