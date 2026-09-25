import { describe, expect, it } from 'vitest';

import type { Task } from '../domain/task';
import { buildTaskList, matchesCategoryFilter, matchesStatusFilter } from './task-list-filter';

const sh = (local: string) => new Date(`${local}+08:00`);
const context = { now: sh('2026-09-25T10:00:00'), timeZone: 'Asia/Shanghai' };

let seq = 0;
const task = (title: string, fields: Partial<Task> = {}): Task => ({
  id: title,
  ownerId: 'u',
  title,
  description: '',
  deadlineAt: null,
  importanceLevel: 0,
  recurrenceRule: null,
  recurrenceDtstart: null,
  completedAt: null,
  createdAt: new Date(Date.UTC(2026, 8, 1) + seq++),
  updatedAt: new Date(Date.UTC(2026, 8, 1)),
  deletedAt: null,
  ...fields,
});

const tasks = [
  task('无截止'),
  task('明天', { deadlineAt: sh('2026-09-26T09:00:00') }),
  task('昨天错过', { deadlineAt: sh('2026-09-24T09:00:00') }),
  task('已完成', { deadlineAt: sh('2026-09-20T09:00:00'), completedAt: sh('2026-09-19T09:00:00') }),
  task('下周', { deadlineAt: sh('2026-10-02T09:00:00') }),
  task('已删除', { deletedAt: sh('2026-09-24T00:00:00') }),
];
const categoryIdsByTask = new Map([
  ['明天', ['work']],
  ['下周', ['home']],
  ['昨天错过', ['work', 'home']],
]);
const titles = (list: Task[]) => list.map((t) => t.title);

describe('matchesStatusFilter', () => {
  it('按派生状态筛选，all 不筛选', () => {
    const missed = { deadlineAt: sh('2026-09-24T09:00:00'), completedAt: null };
    expect(matchesStatusFilter(missed, 'missed', context.now)).toBe(true);
    expect(matchesStatusFilter(missed, 'todo', context.now)).toBe(false);
    expect(matchesStatusFilter(missed, 'all', context.now)).toBe(true);
  });
});

describe('matchesCategoryFilter', () => {
  it('未选分类不筛选；多选为逻辑或', () => {
    expect(matchesCategoryFilter([], [])).toBe(true);
    expect(matchesCategoryFilter(['work'], ['home', 'work'])).toBe(true);
    expect(matchesCategoryFilter([], ['work'])).toBe(false);
  });
});

describe('buildTaskList', () => {
  const build = (status: 'todo' | 'missed' | 'completed' | 'all', categoryIds: string[] = []) =>
    titles(buildTaskList({ tasks, categoryIdsByTask }, { status, categoryIds }, context));

  it('默认待办：按截止时间从近到远，无截止时间排最后，不含已删除', () => {
    expect(build('todo')).toEqual(['明天', '下周', '无截止']);
  });

  it('已错过 / 已完成 / 全部', () => {
    expect(build('missed')).toEqual(['昨天错过']);
    expect(build('completed')).toEqual(['已完成']);
    expect(build('all')).toEqual(['已完成', '昨天错过', '明天', '下周', '无截止']);
  });

  it('状态与分类筛选组合', () => {
    expect(build('todo', ['work'])).toEqual(['明天']);
    expect(build('all', ['home'])).toEqual(['昨天错过', '下周']);
    expect(build('all', ['home', 'work'])).toEqual(['昨天错过', '明天', '下周']);
  });
});
