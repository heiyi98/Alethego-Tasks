import { describe, expect, it } from 'vitest';

import type { Task } from '../domain/task';
import { placeOnMatrix } from '../quadrant/quadrant-classifier';
import { resolveTaskRepresentative, toMatrixCandidate } from './task-representative';

const timeZone = 'Asia/Shanghai';
const sh = (local: string) => new Date(`${local}+08:00`);
const context = { now: sh('2026-09-24T10:00:00'), timeZone }; // 周四

const baseTask: Task = {
  id: 'task-1',
  ownerId: 'user-1',
  groupId: null,
  projectId: null,
  startOn: null,
  endAfterDays: null,
  title: '任务',
  description: '',
  deadlineOn: null,
  importanceLevel: 0,
  recurrenceRule: null,
  recurrenceStartOn: null,
  completedAt: null,
  confirmedAt: null,
  isStarred: false,
  createdAt: sh('2026-09-01T00:00:00'),
  updatedAt: sh('2026-09-01T00:00:00'),
  deletedAt: null,
};

describe('resolveTaskRepresentative', () => {
  it('普通任务的代表是任务本身', () => {
    const task = {
      ...baseTask,
      deadlineOn: '2026-09-26',
      importanceLevel: 3 as const,
    };
    expect(resolveTaskRepresentative(task, [], context)).toEqual({
      taskId: 'task-1',
      importanceLevel: 3,
      deadlineOn: task.deadlineOn,
      occurrenceDate: null,
    });
  });

  it('已完成的普通任务没有代表', () => {
    expect(
      resolveTaskRepresentative({ ...baseTask, completedAt: context.now }, [], context),
    ).toBeNull();
  });

  it('已删除的任务没有代表', () => {
    const task = { ...baseTask, importanceLevel: 3 as const, deletedAt: context.now };
    expect(resolveTaskRepresentative(task, [], context)).toBeNull();
  });

  it('循环任务的代表是日期还没过去的最早未完成实例，继承任务重要性；截止日期就是那一次的日期', () => {
    const task: Task = {
      ...baseTask,
      importanceLevel: 3,
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      recurrenceStartOn: '2026-09-21',
      deadlineOn: '2020-01-01', // 循环任务不使用该字段
    };
    const representative = resolveTaskRepresentative(task, [], context);
    expect(representative).toEqual({
      taskId: 'task-1',
      importanceLevel: 3,
      deadlineOn: '2026-09-25',
      occurrenceDate: '2026-09-25',
    });

    // 矩阵只看到标准形状：周五（明天）的实例 → N = 2，重要且紧急
    const candidate = toMatrixCandidate(representative!, context);
    expect(candidate.urgency).toMatchObject({ kind: 'scheduled', dayNumber: 2 });
    expect(placeOnMatrix(candidate, 'short')).toEqual({
      visible: true,
      quadrant: 'important_urgent',
      overdueDays: null,
      slot: { kind: 'cell', column: 4 },
    });
  });

  it('循环任务永远不逾期：今天这一次在今天过完之前一直是代表（N = 1），之后换成明天的', () => {
    const task: Task = {
      ...baseTask,
      importanceLevel: 1,
      recurrenceRule: 'FREQ=DAILY',
      recurrenceStartOn: '2026-09-01',
    };
    const lateNight = { now: sh('2026-09-24T23:59:00'), timeZone };
    const today = resolveTaskRepresentative(task, [], lateNight)!;
    expect(today.occurrenceDate).toBe('2026-09-24');
    expect(toMatrixCandidate(today, lateNight).urgency).toMatchObject({ dayNumber: 1 });
    const nextDay = { now: sh('2026-09-25T00:00:00'), timeZone };
    expect(resolveTaskRepresentative(task, [], nextDay)!.occurrenceDate).toBe('2026-09-25');
  });
});
