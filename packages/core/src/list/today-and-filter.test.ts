import { describe, expect, it } from 'vitest';

import {
  IMPORTANCE_DEFAULT,
  IMPORTANCE_KEYS,
  IMPORTANCE_LEVELS_STRONG_FIRST,
  isImportant,
} from '../domain/importance';
import { subtaskApplies, subtaskProgress, subtasksFor, type Subtask } from '../domain/subtask';
import type { Task } from '../domain/task';
import {
  DEFAULT_MATRIX_FILTER,
  groupState,
  matrixFilterIncludes,
  parseMatrixFilter,
  personalState,
  toggleCategory,
  toggleGroup,
  togglePersonal,
  toggleProject,
} from '../matrix/matrix-filter';
import { buildTaskList, isRelatedGroupTask, isTodayTask } from './task-list-filter';

const sh = (local: string) => new Date(`${local}+08:00`);
const context = { now: sh('2026-10-09T10:00:00'), timeZone: 'Asia/Shanghai' };

const task = (id: string, fields: Partial<Task> = {}): Task => ({
  id,
  ownerId: 'me',
  groupId: null,
  projectId: null,
  startOn: null,
  endAfterDays: null,
  title: id,
  description: '',
  deadlineAt: null,
  importanceLevel: 0,
  recurrenceRule: null,
  recurrenceDtstart: null,
  completedAt: null,
  confirmedAt: fields.completedAt ?? null,
  isStarred: false,
  createdAt: sh('2026-09-01T00:00:00'),
  updatedAt: sh('2026-09-01T00:00:00'),
  deletedAt: null,
  ...fields,
});

describe('重要性四档', () => {
  it('由强到弱：必须、应该、可以、随意；随意是默认档；应该和必须算重要', () => {
    expect(IMPORTANCE_LEVELS_STRONG_FIRST.map((l) => IMPORTANCE_KEYS[l])).toEqual([
      'must',
      'should',
      'could',
      'optional',
    ]);
    expect(IMPORTANCE_DEFAULT).toBe(0);
    expect([0, 1, 2, 3].map((l) => isImportant(l as 0 | 1 | 2 | 3))).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });
});

describe('和我有关的组任务', () => {
  const ctx = {
    myUserId: 'me',
    projectHasAssignment: (id: string) => id === 'assign',
    assignmentsOf: (taskId: string) =>
      taskId === 'mine' ? [{ role: 'R', userId: 'me' }] : [{ role: 'A', userId: 'me' }],
  };
  it('开了任务分配：我是执行人的；没开：我所在项目的全部任务；个人任务不算', () => {
    expect(isRelatedGroupTask({ id: 'mine', projectId: 'assign' }, ctx)).toBe(true);
    expect(isRelatedGroupTask({ id: 'other', projectId: 'assign' }, ctx)).toBe(false);
    expect(isRelatedGroupTask({ id: 'any', projectId: 'plain' }, ctx)).toBe(true);
    expect(isRelatedGroupTask({ id: 'x', projectId: null }, ctx)).toBe(false);
  });
});

describe('今日', () => {
  const tasks = [
    task('today', { deadlineAt: sh('2026-10-09T23:59:59.999') }),
    task('today-done', {
      deadlineAt: sh('2026-10-09T09:00:00'),
      completedAt: sh('2026-10-09T08:00:00'),
    }),
    task('today-passed', { deadlineAt: sh('2026-10-09T08:00:00') }),
    task('late-1', { deadlineAt: sh('2026-10-08T23:59:59.999') }),
    task('late-2', { deadlineAt: sh('2026-10-07T12:00:00') }),
    task('late-3', { deadlineAt: sh('2026-10-06T23:59:59.999') }),
    task('late-1-done', {
      deadlineAt: sh('2026-10-08T12:00:00'),
      completedAt: sh('2026-10-08T20:00:00'),
    }),
    task('tomorrow', { deadlineAt: sh('2026-10-10T09:00:00') }),
    task('none'),
    task('group-mine', { groupId: 'g', projectId: 'p', deadlineAt: sh('2026-10-09T18:00:00') }),
    task('group-other', { groupId: 'g', projectId: 'q', deadlineAt: sh('2026-10-09T18:00:00') }),
  ];
  it('今天截止的（不管完成没有）+ 逾期不满 3 天还没完成的；逾期满 3 天离开', () => {
    expect(tasks.filter((t) => isTodayTask(t, [], context)).map((t) => t.id)).toEqual([
      'today',
      'today-done',
      'today-passed',
      'late-1',
      'late-2',
      'group-mine',
      'group-other',
    ]);
  });
  it('范围：个人任务 + 和我有关的组任务；状态行照常筛选', () => {
    const list = (status: 'all' | 'todo') =>
      buildTaskList(
        { tasks, categoryIdsByTask: new Map() },
        {
          scope: 'today',
          status,
          categoryIds: [],
          isRelatedGroupTask: (t) => t.projectId === 'p',
        },
        context,
      ).map((t) => t.id);
    expect(list('all')).toContain('group-mine');
    expect(list('all')).not.toContain('group-other');
    expect(list('all')).toContain('today-done');
    expect(list('todo')).not.toContain('today-done');
  });
  it('循环任务看当前的代表实例', () => {
    const daily = task('daily', {
      recurrenceRule: 'FREQ=DAILY',
      recurrenceDtstart: sh('2026-10-01T18:00:00'),
    });
    const weekly = task('weekly', {
      recurrenceRule: 'FREQ=WEEKLY',
      recurrenceDtstart: sh('2026-10-03T18:00:00'),
    });
    expect(isTodayTask(daily, [], context)).toBe(true);
    expect(isTodayTask(weekly, [], context)).toBe(false);
  });
});

describe('矩阵筛选栏', () => {
  const tree = {
    categoryIds: ['c1', 'c2'],
    groups: [{ id: 'g', projectIds: ['p1', 'p2'] }],
  };
  const group = tree.groups[0]!;
  it('第一次进入只勾"个人"；存的值格式不对时用默认值', () => {
    expect(parseMatrixFilter(null)).toEqual(DEFAULT_MATRIX_FILTER);
    expect(parseMatrixFilter('x')).toEqual(DEFAULT_MATRIX_FILTER);
    expect(parseMatrixFilter({ personal: false, projects: ['p1', 3] })).toEqual({
      personal: false,
      categories: [],
      groups: [],
      projects: ['p1'],
    });
  });
  it('勾组 = 勾它下面的全部项目；只勾部分项目时组是部分选中；全勾上等于整组', () => {
    let f = toggleGroup(DEFAULT_MATRIX_FILTER, group);
    expect(groupState(f, group)).toBe('checked');
    f = toggleProject(f, group, 'p2');
    expect(groupState(f, group)).toBe('partial');
    expect(f.projects).toEqual(['p1']);
    f = toggleProject(f, group, 'p2');
    expect(f.groups).toEqual(['g']);
    expect(f.projects).toEqual([]);
    expect(groupState(toggleGroup(f, group), group)).toBe('unchecked');
  });
  it('个人：勾"个人" = 全部个人任务；只勾部分分类时部分选中，只显示这些分类的任务', () => {
    let f = toggleCategory(DEFAULT_MATRIX_FILTER, tree, 'c1');
    expect(personalState(f, tree)).toBe('partial');
    expect(f).toMatchObject({ personal: false, categories: ['c2'] });
    f = togglePersonal(f, tree);
    expect(personalState(f, tree)).toBe('checked');
    f = togglePersonal(f, tree);
    expect(personalState(f, tree)).toBe('unchecked');
  });
  it('并集：个人（含没有分类的）、所选分类、所选项目里和我有关的组任务', () => {
    const ctx = {
      categoryIdsOf: (id: string) => (id === 'in-c1' ? ['c1'] : []),
      isRelatedGroupTask: (t: Pick<Task, 'id'>) => t.id !== 'not-mine',
    };
    const personal = { id: 'loose', groupId: null, projectId: null };
    const inC1 = { id: 'in-c1', groupId: null, projectId: null };
    const groupTask = { id: 'g-task', groupId: 'g', projectId: 'p1' };
    const notMine = { id: 'not-mine', groupId: 'g', projectId: 'p1' };
    expect(matrixFilterIncludes(personal, DEFAULT_MATRIX_FILTER, ctx)).toBe(true);
    expect(matrixFilterIncludes(groupTask, DEFAULT_MATRIX_FILTER, ctx)).toBe(false);
    const f = { personal: false, categories: ['c1'], groups: [], projects: ['p1'] };
    expect(matrixFilterIncludes(personal, f, ctx)).toBe(false);
    expect(matrixFilterIncludes(inC1, f, ctx)).toBe(true);
    expect(matrixFilterIncludes(groupTask, f, ctx)).toBe(true);
    expect(matrixFilterIncludes(notMine, f, ctx)).toBe(false);
  });
});

describe('子任务', () => {
  const sub = (
    id: string,
    created: string,
    deleted: string | null = null,
    position = 0,
  ): Subtask => ({
    id,
    taskId: 't',
    title: id,
    position,
    createdAt: sh(created),
    deletedAt: deleted ? sh(deleted) : null,
  });
  const list = [
    sub('old', '2026-10-01T00:00:00', null, 0),
    sub('removed', '2026-10-01T00:00:00', '2026-10-05T00:00:00', 1),
    sub('new', '2026-10-06T00:00:00', null, 2),
  ];
  it('普通任务：没删除的；循环任务的某一次：那一次之前就有、之后才删的（改清单只影响以后）', () => {
    expect(subtasksFor(list, null).map((s) => s.id)).toEqual(['old', 'new']);
    expect(subtasksFor(list, sh('2026-10-03T09:00:00')).map((s) => s.id)).toEqual([
      'old',
      'removed',
    ]);
    expect(subtasksFor(list, sh('2026-10-09T09:00:00')).map((s) => s.id)).toEqual(['old', 'new']);
    expect(subtaskApplies(list[1]!, sh('2026-10-05T00:00:00'))).toBe(false);
  });
  it('进度按这一次自己的勾选算，各次互不相关', () => {
    const d1 = sh('2026-10-03T09:00:00');
    const d2 = sh('2026-10-04T09:00:00');
    const checks = [{ subtaskId: 'old', occurrenceDate: d1 }];
    expect(subtaskProgress(list, checks, d1)).toEqual({ done: 1, total: 2 });
    expect(subtaskProgress(list, checks, d2)).toEqual({ done: 0, total: 2 });
    expect(subtaskProgress(list, [{ subtaskId: 'new', occurrenceDate: null }], null)).toEqual({
      done: 1,
      total: 2,
    });
  });
});
