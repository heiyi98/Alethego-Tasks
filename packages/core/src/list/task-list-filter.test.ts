import { describe, expect, it } from 'vitest';

import type { Task } from '../domain/task';
import {
  buildTaskList,
  categoriesForQuickAdd,
  matchesCategoryFilter,
  matchesStatusFilter,
  starredForQuickAdd,
} from './task-list-filter';

const sh = (local: string) => new Date(`${local}+08:00`);
const context = { now: sh('2026-09-25T10:00:00'), timeZone: 'Asia/Shanghai' };

let seq = 0;
const task = (title: string, fields: Partial<Task> = {}): Task => ({
  id: title,
  ownerId: 'u',
  groupId: null,
  title,
  description: '',
  deadlineAt: null,
  importanceLevel: 0,
  recurrenceRule: null,
  recurrenceDtstart: null,
  completedAt: null,
  isStarred: false,
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
    const missed = { deadlineAt: sh('2026-09-24T09:00:00'), completedAt: null, isStarred: false };
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

describe('循环任务在列表中的状态', () => {
  const gym = task('健身', {
    recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
    recurrenceDtstart: sh('2026-09-21T07:00:00'),
    // 循环任务不看这两个字段
    deadlineAt: sh('2026-09-01T00:00:00'),
    completedAt: sh('2026-09-02T00:00:00'),
  });
  const ended = task('两次就结束', {
    recurrenceRule: 'FREQ=DAILY;COUNT=2',
    recurrenceDtstart: sh('2026-09-20T07:00:00'),
  });

  it('进行中的循环任务是待办，按代表实例排序；已结束的序列算已完成', () => {
    const sources = { tasks: [gym, ended, tasks[4]!], categoryIdsByTask: new Map() };
    expect(titles(buildTaskList(sources, { status: 'todo', categoryIds: [] }, context))).toEqual([
      '健身', // 代表实例：今天（周五）07:00
      '下周',
    ]);
    expect(
      titles(buildTaskList(sources, { status: 'completed', categoryIds: [] }, context)),
    ).toEqual(['两次就结束']);
    expect(titles(buildTaskList(sources, { status: 'missed', categoryIds: [] }, context))).toEqual(
      [],
    );
  });

  it('本次实例完成后，代表实例顺延', () => {
    const occurrencesByTask = new Map([
      [
        '健身',
        [
          {
            id: 'o1',
            taskId: '健身',
            occurrenceDate: sh('2026-09-25T07:00:00'),
            status: 'completed' as const,
            completedAt: sh('2026-09-25T08:00:00'),
            createdAt: sh('2026-09-25T00:00:00'),
          },
        ],
      ],
    ]);
    const sources = { tasks: [gym, tasks[4]!], categoryIdsByTask: new Map(), occurrencesByTask };
    // 下次是 9/28（周一），在"下周"（10/2）之前
    expect(titles(buildTaskList(sources, { status: 'todo', categoryIds: [] }, context))).toEqual([
      '健身',
      '下周',
    ]);
  });
});

describe('容器：个人与组各归各的', () => {
  const personal = task('个人', { isStarred: true });
  const inGroup = task('组任务', { groupId: 'g1' });
  const otherGroup = task('别的组', { groupId: 'g2' });
  const sources = {
    tasks: [personal, inGroup, otherGroup],
    categoryIdsByTask: new Map([['个人', ['work']]]),
  };

  it('总览（个人）只有个人任务，组任务不进总览', () => {
    expect(titles(buildTaskList(sources, { status: 'all', categoryIds: [] }, context))).toEqual([
      '个人',
    ]);
  });

  it('组里只有这个组的任务；范围和分类在组里不起作用', () => {
    expect(
      titles(
        buildTaskList(
          sources,
          { groupId: 'g1', scope: 'starred', status: 'all', categoryIds: ['work'] },
          context,
        ),
      ),
    ).toEqual(['组任务']);
  });
});

describe('categoriesForQuickAdd', () => {
  it('带上当前选中的全部分类；没选分类就不带', () => {
    expect(categoriesForQuickAdd(['work'])).toEqual(['work']);
    expect(categoriesForQuickAdd(['work', 'home'])).toEqual(['work', 'home']);
    expect(categoriesForQuickAdd([])).toEqual([]);
  });
});

describe('收藏', () => {
  const starredTasks = [
    task('星标待办', { isStarred: true, deadlineAt: sh('2026-09-27T09:00:00') }),
    task('星标已完成', {
      isStarred: true,
      deadlineAt: sh('2026-09-20T09:00:00'),
      completedAt: sh('2026-09-19T09:00:00'),
    }),
    task('星标已删除', { isStarred: true, deletedAt: sh('2026-09-24T00:00:00') }),
    task('没标星', { deadlineAt: sh('2026-09-26T09:00:00') }),
  ];
  const cats = new Map([['星标待办', ['work']]]);
  const build = (categoryIds: string[], status: 'all' | 'todo' | 'completed' | 'missed' = 'all') =>
    titles(
      buildTaskList(
        { tasks: starredTasks, categoryIdsByTask: cats },
        { scope: 'starred', status, categoryIds },
        context,
      ),
    );

  it('范围"收藏"= 所有标星任务，不含已删除，排序规则不变', () => {
    expect(build([])).toEqual(['星标已完成', '星标待办']);
  });

  it('内容 = 范围 ∩ 分类 ∩ 状态', () => {
    expect(build(['work'])).toEqual(['星标待办']);
    expect(build(['home'])).toEqual([]);
    expect(build([], 'todo')).toEqual(['星标待办']);
    expect(build([], 'completed')).toEqual(['星标已完成']);
  });

  it('范围默认为"全部"', () => {
    expect(
      titles(
        buildTaskList(
          { tasks: starredTasks, categoryIdsByTask: cats },
          { status: 'todo', categoryIds: [] },
          context,
        ),
      ),
    ).toEqual(['没标星', '星标待办']);
  });

  it('在"收藏"里快速添加的任务自动标星', () => {
    expect(starredForQuickAdd('starred')).toBe(true);
    expect(starredForQuickAdd('all')).toBe(false);
  });
});
