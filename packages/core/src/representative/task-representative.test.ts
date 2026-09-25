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
  createdAt: sh('2026-09-01T00:00:00'),
  updatedAt: sh('2026-09-01T00:00:00'),
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

  it('循环任务的代表是日期未过去的最早未完成实例，继承任务重要性', () => {
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
      deadlineAt: sh('2026-09-25T23:59:59.999'),
      occurrenceAt: sh('2026-09-25T07:00:00'),
    });

    // 矩阵只看到标准形状：周五（明天）的实例 → 第 1 档，重要且紧急
    const candidate = toMatrixCandidate(representative!, context);
    expect(candidate.urgency).toMatchObject({ kind: 'scheduled', tierIndex: 1 });
    expect(placeOnMatrix(candidate)).toEqual({
      visible: true,
      quadrant: 'important_urgent',
      overdueDays: null,
    });
  });

  it('循环任务今天的实例即使时刻已过也不算逾期', () => {
    const task: Task = {
      ...baseTask,
      importanceLevel: 1,
      recurrenceRule: 'FREQ=DAILY',
      recurrenceDtstart: sh('2026-09-01T07:00:00'),
    };
    const representative = resolveTaskRepresentative(task, [], context)!;
    expect(toMatrixCandidate(representative, context).urgency).toMatchObject({
      kind: 'scheduled',
      tierIndex: 0,
    });
  });
});
