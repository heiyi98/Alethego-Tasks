'use client';

import type { Category, Group, RecurrenceOccurrence, Task } from '@alethego/core';
import { syncOccurrences, type GroupNotification } from '@alethego/data';
import { useCallback, useEffect, useState } from 'react';

import { useRepositories } from '@/components/repositories-provider';
import { browserTimeZone, errorMessage } from '@/lib/format';

export interface TaskListData {
  tasks: Task[];
  categories: Category[];
  categoryIdsByTask: Map<string, string[]>;
  /** 循环任务的实例记录（用于确定代表实例）；普通任务不在其中 */
  occurrencesByTask: Map<string, RecurrenceOccurrence[]>;
  /** 我所在的所有组 */
  groups: Group[];
  /** 应用内通知（入组邀请、删除组的投票）与上次打开通知的时间 */
  notifications: GroupNotification[];
  notificationsSeenAt: Date | null;
}

/**
 * 列表 / 矩阵页数据：任务（个人与我所在组的）+ 分类 + 分类关联 + 循环实例记录 + 组 + 通知。
 * 筛选在客户端完成，切换筛选无需重新请求。
 */
export function useTaskListData() {
  const repositories = useRepositories();
  const [data, setData] = useState<TaskListData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      // 没有后台定时任务：打开 TaskApp 时检查删除组的投票是否已满一周（满一周未操作算作同意）
      await repositories.groups.processExpiredDeletions();
      const [tasks, categories, groups, notifications] = await Promise.all([
        repositories.tasks.list(),
        repositories.categories.list(),
        repositories.groups.list(),
        repositories.groups.notifications(),
      ]);
      const recurring = tasks.filter((task) => task.recurrenceRule);
      const [categoryIdsByTask, occurrences] = await Promise.all([
        repositories.categories.listCategoryIdsByTask(tasks.map((task) => task.id)),
        // 读取时顺带执行归档（生成已出现实例的记录、把被取代的 pending 标为 missed）
        Promise.all(
          recurring.map((task) =>
            syncOccurrences(repositories.occurrences, task, {
              now: new Date(),
              timeZone: browserTimeZone(),
            }),
          ),
        ),
      ]);
      const occurrencesByTask = new Map(recurring.map((task, i) => [task.id, occurrences[i]!]));
      setData({
        tasks,
        categories,
        categoryIdsByTask,
        occurrencesByTask,
        groups,
        notifications: notifications.items,
        notificationsSeenAt: notifications.seenAt,
      });
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [repositories]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** 本地替换一条任务（乐观更新 / 写入保存结果），不重新请求 */
  const replaceTask = useCallback((task: Task) => {
    setData((current) =>
      current
        ? { ...current, tasks: current.tasks.map((t) => (t.id === task.id ? task : t)) }
        : current,
    );
  }, []);

  /** 本地更新（或新增）一条循环实例记录 */
  const upsertOccurrence = useCallback((occurrence: RecurrenceOccurrence) => {
    setData((current) => {
      if (!current) return current;
      const records = current.occurrencesByTask.get(occurrence.taskId) ?? [];
      const next = [...records.filter((o) => o.id !== occurrence.id), occurrence].sort(
        (a, b) => a.occurrenceDate.getTime() - b.occurrenceDate.getTime(),
      );
      const occurrencesByTask = new Map(current.occurrencesByTask);
      occurrencesByTask.set(occurrence.taskId, next);
      return { ...current, occurrencesByTask };
    });
  }, []);

  return { data, error, reload, replaceTask, upsertOccurrence };
}
