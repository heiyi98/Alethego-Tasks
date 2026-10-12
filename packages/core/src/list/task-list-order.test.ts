import { describe, expect, it } from 'vitest';

import type { Task } from '../domain/task';
import { compareByDeadline, listDeadlineOf, sortByDeadline } from './task-list-order';

const sh = (local: string) => new Date(`${local}+08:00`);
const item = (id: string, deadline: string | null, created = '2026-09-01T00:00:00') => ({
  id,
  deadlineOn: deadline ? deadline.slice(0, 10) : null,
  createdAt: sh(created),
});

describe('sortByDeadline', () => {
  it('截止日期从近到远，无截止日期排最后', () => {
    const sorted = sortByDeadline([
      item('none', null),
      item('far', '2026-12-01T00:00:00'),
      item('overdue', '2026-09-01T00:00:00'),
      item('soon', '2026-09-26T09:00:00'),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(['overdue', 'soon', 'far', 'none']);
  });

  it('截止日期相同（或都没有）时新建的在前，再按 id 稳定排序', () => {
    const sorted = sortByDeadline([
      item('b', null, '2026-09-01T00:00:00'),
      item('a', null, '2026-09-01T00:00:00'),
      item('newer', null, '2026-09-20T00:00:00'),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(['newer', 'a', 'b']);
  });

  it('不修改原数组', () => {
    const items = [item('none', null), item('soon', '2026-09-26T09:00:00')];
    sortByDeadline(items);
    expect(items.map((t) => t.id)).toEqual(['none', 'soon']);
    expect(compareByDeadline(items[0]!, items[0]!)).toBe(0);
  });
});

describe('listDeadlineOf', () => {
  const context = { now: sh('2026-09-24T10:00:00'), timeZone: 'Asia/Shanghai' };
  const task: Task = {
    id: 't',
    ownerId: 'u',
    groupId: null,
    projectId: null,
    startOn: null,
    endAfterDays: null,
    title: '健身',
    description: '',
    deadlineOn: '2026-10-01',
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

  it('普通任务取截止日期', () => {
    expect(listDeadlineOf(task, [], context)).toEqual(task.deadlineOn);
  });

  it('循环任务取代表实例的日期', () => {
    const recurring = {
      ...task,
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      recurrenceStartOn: '2026-09-21',
    };
    expect(listDeadlineOf(recurring, [], context)).toEqual('2026-09-25');
  });
});
