'use client';

import type { Category, RecurrenceOccurrence, Task } from '@alethego/core';
import { syncOccurrences } from '@alethego/data';
import { useCallback, useEffect, useState } from 'react';

import { useRepositories } from '@/components/repositories-provider';
import { browserTimeZone, errorMessage } from '@/lib/format';

export interface TaskListData {
  tasks: Task[];
  categories: Category[];
  categoryIdsByTask: Map<string, string[]>;
  /** 循环任务的实例记录（用于确定代表实例）；普通任务不在其中 */
  occurrencesByTask: Map<string, RecurrenceOccurrence[]>;
}

/** 列表 / 矩阵页数据：任务 + 分类 + 分类关联 + 循环实例记录。筛选在客户端完成，切换筛选无需重新请求。 */
export function useTaskListData() {
  const repositories = useRepositories();
  const [data, setData] = useState<TaskListData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [tasks, categories] = await Promise.all([
        repositories.tasks.list(),
        repositories.categories.list(),
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
      setData({ tasks, categories, categoryIdsByTask, occurrencesByTask });
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
