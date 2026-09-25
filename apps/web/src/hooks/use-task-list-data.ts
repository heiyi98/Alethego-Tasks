'use client';

import type { Category, Task } from '@alethego/core';
import { useCallback, useEffect, useState } from 'react';

import { useRepositories } from '@/components/repositories-provider';
import { errorMessage } from '@/lib/format';

export interface TaskListData {
  tasks: Task[];
  categories: Category[];
  categoryIdsByTask: Map<string, string[]>;
}

/** 列表页数据：任务 + 分类 + 任务的分类关联。筛选在客户端完成，切换筛选无需重新请求。 */
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
      const categoryIdsByTask = await repositories.categories.listCategoryIdsByTask(
        tasks.map((task) => task.id),
      );
      setData({ tasks, categories, categoryIdsByTask });
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

  return { data, error, reload, replaceTask };
}
