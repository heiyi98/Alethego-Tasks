'use client';

import {
  featuresForProject,
  type Category,
  type Group,
  type Project,
  type RecurrenceOccurrence,
  type Subtask,
  type SubtaskCheck,
  type Task,
  type TaskAssignment,
  type TaskRelation,
} from '@alethego/core';
import { syncOccurrences, type GroupNotification } from '@alethego/data';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useRepositories } from '@/components/repositories-provider';
import { browserTimeZone, errorMessage } from '@/lib/format';

export interface TaskListData {
  tasks: Task[];
  categories: Category[];
  categoryIdsByTask: Map<string, string[]>;
  /** 循环任务的实例记录（用于确定代表实例）；普通任务不在其中 */
  occurrencesByTask: Map<string, RecurrenceOccurrence[]>;
  /** 我能看到的所有组 */
  groups: Group[];
  /** 我能看到的所有项目 */
  projects: Project[];
  /** 任务上的 RACI（只有开了任务分配的项目的任务） */
  assignmentsByTask: Map<string, TaskAssignment[]>;
  /** 任务关系：taskId → 这个任务的开始 / 结束挂着的关系 */
  relationsByTask: Map<string, TaskRelation[]>;
  /** 子任务：taskId → 这个任务的子任务（包括已删除的，循环任务过去各次要用） */
  subtasksByTask: Map<string, Subtask[]>;
  /** 子任务的勾选（普通任务 occurrenceDate 为 null；循环任务每一次各自勾选） */
  subtaskChecks: SubtaskCheck[];
  /** 应用内通知与上次打开通知的时间 */
  notifications: GroupNotification[];
  notificationsSeenAt: Date | null;
}

/**
 * 所有看法（清单、时间管理矩阵、责任分配矩阵……）共用的数据：任务（个人与我所在项目的）+ 分类 +
 * 分类关联 + 循环实例记录 + RACI + 组 + 项目 + 通知。各看法只负责怎么画；筛选在客户端完成，切换无需重新请求。
 */
export function useTaskListData() {
  const repositories = useRepositories();
  const [data, setData] = useState<TaskListData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 防止旧数据覆盖新数据：同时有多次加载时只用最后开始的那一次；
  // 加载期间本地改过（勾选完成等）时，这次读到的可能是改之前的数据，丢掉重新加载
  const loadSeq = useRef(0);
  const localVersion = useRef(0);

  const reload = useCallback(async (): Promise<void> => {
    const seq = ++loadSeq.current;
    const version = localVersion.current;
    try {
      // 没有后台定时任务：打开 TaskApp 时检查投票是否超时（删除组和项目一周、任命组长三天，未操作算作同意）
      await repositories.groups.processTimeouts();
      const [tasks, categories, groups, projects, notifications] = await Promise.all([
        repositories.tasks.list(),
        repositories.categories.list(),
        repositories.groups.list(),
        repositories.projects.list(),
        repositories.groups.notifications(),
      ]);
      const recurring = tasks.filter((task) => task.recurrenceRule);
      const raciProjects = new Set(
        projects.filter((p) => featuresForProject(p).raci).map((p) => p.id),
      );
      const raciTaskIds = tasks
        .filter((task) => task.projectId && raciProjects.has(task.projectId))
        .map((task) => task.id);
      const [categoryIdsByTask, occurrences, assignments, relations, subtasks] = await Promise.all([
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
        repositories.relations.listForTasks(
          tasks.filter((task) => !task.recurrenceRule).map((task) => task.id),
        ),
        repositories.subtasks.listForTasks(tasks.map((task) => task.id)),
      ]);
      const subtasksByTask = new Map<string, Subtask[]>();
      for (const subtask of subtasks.subtasks) {
        subtasksByTask.set(subtask.taskId, [
          ...(subtasksByTask.get(subtask.taskId) ?? []),
          subtask,
        ]);
      }
      const relationsByTask = new Map<string, TaskRelation[]>();
      for (const relation of relations) {
        relationsByTask.set(relation.taskId, [
          ...(relationsByTask.get(relation.taskId) ?? []),
          relation,
        ]);
      }
      const assignmentsByTask = new Map<string, TaskAssignment[]>();
      for (const assignment of assignments) {
        const list = assignmentsByTask.get(assignment.taskId) ?? [];
        list.push(assignment);
        assignmentsByTask.set(assignment.taskId, list);
      }
      const occurrencesByTask = new Map(recurring.map((task, i) => [task.id, occurrences[i]!]));
      if (seq !== loadSeq.current) return;
      if (version !== localVersion.current) {
        await reload();
        return;
      }
      setData({
        tasks,
        categories,
        categoryIdsByTask,
        occurrencesByTask,
        assignmentsByTask,
        relationsByTask,
        subtasksByTask,
        subtaskChecks: subtasks.checks,
        groups,
        projects,
        notifications: notifications.items,
        notificationsSeenAt: notifications.seenAt,
      });
      setError(null);
    } catch (e) {
      if (seq === loadSeq.current) setError(errorMessage(e));
    }
  }, [repositories]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** 本地替换一条任务（乐观更新 / 写入保存结果），不重新请求 */
  const replaceTask = useCallback((task: Task) => {
    localVersion.current++;
    setData((current) =>
      current
        ? { ...current, tasks: current.tasks.map((t) => (t.id === task.id ? task : t)) }
        : current,
    );
  }, []);

  /** 本地更新（或新增）一条循环实例记录 */
  const upsertOccurrence = useCallback((occurrence: RecurrenceOccurrence) => {
    localVersion.current++;
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

  /** 本地勾选 / 取消一个子任务（乐观更新） */
  const setSubtaskCheck = useCallback(
    (subtaskId: string, occurrenceDate: Date | null, checked: boolean) => {
      localVersion.current++;
      setData((current) => {
        if (!current) return current;
        const same = (c: SubtaskCheck) =>
          c.subtaskId === subtaskId &&
          (c.occurrenceDate?.getTime() ?? null) === (occurrenceDate?.getTime() ?? null);
        const rest = current.subtaskChecks.filter((c) => !same(c));
        return {
          ...current,
          subtaskChecks: checked ? [...rest, { subtaskId, occurrenceDate }] : rest,
        };
      });
    },
    [],
  );

  return { data, error, reload, replaceTask, upsertOccurrence, setSubtaskCheck };
}
