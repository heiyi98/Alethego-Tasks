'use client';

import {
  CONTAINER_FEATURES,
  type Category,
  type Group,
  type RecurrenceOccurrence,
  type Task,
  type TaskAssignment,
} from '@alethego/core';
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
  /** 任务上的 RACI（只有用 RACI 的组的任务） */
  assignmentsByTask: Map<string, TaskAssignment[]>;
  /** 应用内通知与上次打开通知的时间 */
  notifications: GroupNotification[];
  notificationsSeenAt: Date | null;
}

/**
 * 所有看法（清单、时间管理矩阵、责任分配矩阵……）共用的数据：任务（个人与我所在组的）+ 分类 +
 * 分类关联 + 循环实例记录 + RACI + 组 + 通知。各看法只负责怎么画；筛选在客户端完成，切换无需重新请求。
 */
export function useTaskListData() {
  const repositories = useRepositories();
  const [data, setData] = useState<TaskListData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      // 没有后台定时任务：打开 TaskApp 时检查投票是否超时（删除组一周、任命组长三天，未操作算作同意）
      await repositories.groups.processTimeouts();
      const [tasks, categories, groups, notifications] = await Promise.all([
        repositories.tasks.list(),
        repositories.categories.list(),
        repositories.groups.list(),
        repositories.groups.notifications(),
      ]);
      const recurring = tasks.filter((task) => task.recurrenceRule);
      const raciGroups = new Set(
        groups.filter((g) => CONTAINER_FEATURES[g.kind].raci).map((g) => g.id),
      );
      const raciTaskIds = tasks
        .filter((task) => task.groupId && raciGroups.has(task.groupId))
        .map((task) => task.id);
      const [categoryIdsByTask, occurrences, assignments] = await Promise.all([
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
        repositories.assignments.listForTasks(raciTaskIds),
      ]);
      const assignmentsByTask = new Map<string, TaskAssignment[]>();
      for (const assignment of assignments) {
        const list = assignmentsByTask.get(assignment.taskId) ?? [];
        list.push(assignment);
        assignmentsByTask.set(assignment.taskId, list);
      }
      const occurrencesByTask = new Map(recurring.map((task, i) => [task.id, occurrences[i]!]));
      setData({
        tasks,
        categories,
        categoryIdsByTask,
        occurrencesByTask,
        assignmentsByTask,
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
