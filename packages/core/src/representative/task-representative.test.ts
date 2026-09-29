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
  title: '任务',
  description: '',
  deadlineAt: null,
  importanceLevel: 0,
  recurrenceRule: null,
  recurrenceDtstart: null,
  completedAt: null,
  isStarred: false,
  createdAt: sh('2026-09-01T00:00:00'),
  updatedAt: sh('2026-09-01T00:00:00'),
  deletedAt: null,
};

describe('resolveTaskRepresentative', () => {
  it('普通任务的代表是任务本身', () => {
    const task = {
      ...baseTask,
      deadlineAt: sh('2026-09-26T18:00:00'),
      importanceLevel: 4 as const,
    };
    expect(resolveTaskRepresentative(task, [], context)).toEqual({
      taskId: 'task-1',
      importanceLevel: 4,
      deadlineAt: task.deadlineAt,
      occurrenceAt: null,
    });
  });

  it('已完成的普通任务没有代表', () => {
    expect(
      resolveTaskRepresentative({ ...baseTask, completedAt: context.now }, [], context),
    ).toBeNull();
  });

  it('已删除的任务没有代表', () => {
    const task = { ...baseTask, importanceLevel: 5 as const, deletedAt: context.now };
    expect(resolveTaskRepresentative(task, [], context)).toBeNull();
  });

  it('循环任务的代表是时刻未过的最早未完成实例，继承任务重要性；截止时间就是实例时刻', () => {
    const task: Task = {
      ...baseTask,
      importanceLevel: 3,
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      recurrenceDtstart: sh('2026-09-21T07:00:00'),
      deadlineAt: sh('2020-01-01T00:00:00'), // 循环任务不使用该字段
    };
    const representative = resolveTaskRepresentative(task, [], context);
    expect(representative).toEqual({
      taskId: 'task-1',
      importanceLevel: 3,
      deadlineAt: sh('2026-09-25T07:00:00'),
      occurrenceAt: sh('2026-09-25T07:00:00'),
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

  it('循环任务永远不逾期：今天的实例时刻已过，代表换成明天的实例', () => {
    const task: Task = {
      ...baseTask,
      importanceLevel: 1,
      recurrenceRule: 'FREQ=DAILY',
      recurrenceDtstart: sh('2026-09-01T07:00:00'),
    };
    const representative = resolveTaskRepresentative(task, [], context)!;
    expect(representative.occurrenceAt).toEqual(sh('2026-09-25T07:00:00'));
    expect(toMatrixCandidate(representative, context).urgency).toMatchObject({
      kind: 'scheduled',
      dayNumber: 2,
    });
  });

  it('今天的实例时刻还没到：代表仍是今天的实例（N = 1）', () => {
    const task: Task = {
      ...baseTask,
      importanceLevel: 1,
      recurrenceRule: 'FREQ=DAILY',
      recurrenceDtstart: sh('2026-09-01T20:00:00'),
    };
    const representative = resolveTaskRepresentative(task, [], context)!;
    expect(representative.occurrenceAt).toEqual(sh('2026-09-24T20:00:00'));
    expect(toMatrixCandidate(representative, context).urgency).toMatchObject({ dayNumber: 1 });
  });
});
