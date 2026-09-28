'use client';

import type { Task } from '@alethego/core';
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
  actionError: string | null;
}

const TaskDataContext = createContext<TaskDataValue | null>(null);

export function TaskDataProvider({ children }: { children: ReactNode }) {
  const repositories = useRepositories();
  const pathname = usePathname();
  const { data, error, reload, replaceTask, upsertOccurrence } = useTaskListData();
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
        if (done) upsertOccurrence(done);
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
      setActionError(null);
    } catch (e) {
      setActionError(errorMessage(e));
      await reload();
    }
  }

  return (
    <TaskDataContext.Provider
      value={{ data, error, now, timeZone, reload, toggleComplete, actionError }}
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
