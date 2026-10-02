import { describe, expect, it } from 'vitest';

import type { Task } from '../domain/task';
import {
  MATRIX_COLUMNS,
  MATRIX_MIDLINE_BOUNDARY,
  buildMatrixLayout,
  groupPointsByQuadrant,
  offsetForId,
} from './matrix-layout';

const timeZone = 'Asia/Shanghai';
const sh = (local: string) => new Date(`${local}+08:00`);
const context = { now: sh('2026-09-24T10:00:00'), timeZone }; // 周四

let seq = 0;
const task = (id: string, fields: Partial<Task> = {}): Task => ({
  id,
  ownerId: 'u',
  groupId: null,
  projectId: null,
  title: id,
  description: '',
  deadlineAt: null,
  importanceLevel: 0,
  recurrenceRule: null,
  recurrenceDtstart: null,
  completedAt: null,
  // 个人任务完成即确认
  confirmedAt: fields.completedAt ?? null,
  isStarred: false,
  createdAt: new Date(Date.UTC(2026, 8, 1) + seq++),
  updatedAt: new Date(Date.UTC(2026, 8, 1)),
  deletedAt: null,
  ...fields,
});

const layout = (tasks: Task[], mode: 'short' | 'long' = 'short') =>
  buildMatrixLayout({ tasks }, context, mode);
const pointOf = (tasks: Task[], id: string, mode: 'short' | 'long' = 'short') =>
  layout(tasks, mode).points.find((p) => p.task.id === id);
const cell = (column: number) => ({ kind: 'cell', column });

describe('格子', () => {
  it('6 格，中线在正中', () => {
    expect(MATRIX_COLUMNS).toBe(6);
    expect(MATRIX_MIDLINE_BOUNDARY).toBe(3);
  });
});

describe('buildMatrixLayout', () => {
  it('按紧迫度列与重要性行放置，并给出象限', () => {
    const tasks = [
      task('tomorrow-5', { deadlineAt: sh('2026-09-25T09:00:00'), importanceLevel: 5 }),
      task('month-1', { deadlineAt: sh('2026-10-24T09:00:00'), importanceLevel: 1 }),
      task('nodeadline-3', { importanceLevel: 3 }),
    ];
    // 今天周四：明天（周五）N = 2 → 短期"2天–1天"那一格；长期"3天"那一格
    expect(pointOf(tasks, 'tomorrow-5')).toMatchObject({
      slot: cell(4),
      row: 5,
      quadrant: 'important_urgent',
      overdueDays: null,
    });
    expect(pointOf(tasks, 'tomorrow-5', 'long')).toMatchObject({ slot: cell(5) });
    // 10月24日：N = 31 → 短期不画、只进四象限清单；长期 31–90 那一格
    expect(pointOf(tasks, 'month-1')).toMatchObject({
      slot: null,
      row: 1,
      quadrant: 'not_important_not_urgent',
    });
    expect(pointOf(tasks, 'month-1', 'long')).toMatchObject({ slot: cell(1) });
    for (const mode of ['short', 'long'] as const) {
      expect(pointOf(tasks, 'nodeadline-3', mode)).toMatchObject({
        slot: { kind: 'no_deadline' },
        row: 3,
        quadrant: 'important_not_urgent',
      });
    }
  });

  it('重要性为 0 但有截止时间 → 最下一行，照常上矩阵', () => {
    const tasks = [task('t', { deadlineAt: sh('2026-09-24T20:00:00') })];
    expect(pointOf(tasks, 't')).toMatchObject({ slot: cell(5), row: 0 });
  });

  it('按日历日判档：明天 09:00 与明天全天落在同一格', () => {
    const tasks = [
      task('tomorrow-9', { deadlineAt: sh('2026-09-25T09:00:00'), importanceLevel: 3 }),
      task('tomorrow-eod', { deadlineAt: sh('2026-09-25T23:59:59.999'), importanceLevel: 3 }),
    ];
    expect(pointOf(tasks, 'tomorrow-9')).toMatchObject({ slot: cell(4) });
    expect(pointOf(tasks, 'tomorrow-eod')).toMatchObject({ slot: cell(4) });
  });

  it('逾期区：逾期 0 / 1 / 2 天进逾期区；满 3 天退场', () => {
    const tasks = [
      task('late-0', { deadlineAt: sh('2026-09-24T09:00:00'), importanceLevel: 2 }),
      task('late-1', { deadlineAt: sh('2026-09-23T23:59:59.999'), importanceLevel: 2 }),
      task('late-2', { deadlineAt: sh('2026-09-22T09:00:00'), importanceLevel: 2 }),
      task('late-3', { deadlineAt: sh('2026-09-21T23:59:59.999'), importanceLevel: 2 }),
      task('late-5', { deadlineAt: sh('2026-09-19T09:00:00'), importanceLevel: 2 }),
    ];
    const result = layout(tasks);
    expect(result.points.map((p) => [p.task.id, p.slot?.kind, p.overdueDays])).toEqual([
      ['late-0', 'overdue', 0],
      ['late-1', 'overdue', 1],
      ['late-2', 'overdue', 2],
    ]);
    expect(result.hidden.overdue_expired).toBe(2);
  });

  it('循环任务永远不进逾期区：实例时刻一过，代表就换成下一次', () => {
    const daily = task('daily', {
      importanceLevel: 3,
      recurrenceRule: 'FREQ=DAILY',
      recurrenceDtstart: sh('2026-09-01T08:00:00'),
    });
    const point = pointOf([daily], 'daily');
    // 现在周四 10:00，今天 08:00 的实例已过 → 代表是明天 08:00 → N = 2
    expect(point).toMatchObject({ slot: cell(4), overdueDays: null });
    expect(point?.representative.occurrenceAt).toEqual(sh('2026-09-25T08:00:00'));
  });

  it('不上矩阵的任务计入 hidden；已完成 / 已删除的不计入', () => {
    const result = layout([
      task('unprocessed'),
      task('far', { deadlineAt: sh('2028-01-01T00:00:00'), importanceLevel: 5 }),
      task('done', { importanceLevel: 5, completedAt: sh('2026-09-20T00:00:00') }),
      task('deleted', { importanceLevel: 5, deletedAt: sh('2026-09-20T00:00:00') }),
    ]);
    expect(result.points).toEqual([]);
    expect(result.hidden).toEqual({ unprocessed: 1, far_future: 1, overdue_expired: 0 });
  });

  it('循环任务以代表实例上矩阵（周三没做，周四显示周五）', () => {
    const recurring = task('gym', {
      importanceLevel: 4,
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      recurrenceDtstart: sh('2026-09-21T07:00:00'),
    });
    const point = pointOf([recurring], 'gym');
    // 代表实例周五（N = 2）→ "2天–1天"那一格
    expect(point).toMatchObject({ slot: cell(4), row: 4, quadrant: 'important_urgent' });
    expect(point?.representative.occurrenceAt).toEqual(sh('2026-09-25T07:00:00'));
  });

  it('格内偏移按任务 id 固定：与输入顺序、同格的其他任务无关', () => {
    const tasks = Array.from({ length: 9 }, (_, i) =>
      task(`same-${i}`, { deadlineAt: sh('2026-09-25T09:00:00'), importanceLevel: 4 }),
    );
    const first = layout(tasks).points;
    for (const p of first) {
      expect(p.offsetX).toBeGreaterThanOrEqual(0);
      expect(p.offsetX).toBeLessThanOrEqual(1);
      expect({ x: p.offsetX, y: p.offsetY }).toEqual(offsetForId(p.task.id));
    }
    const alone = pointOf([tasks[3]!], 'same-3')!;
    expect(alone).toMatchObject({ offsetX: first[3]!.offsetX, offsetY: first[3]!.offsetY });
    // 不同 id 的偏移各不相同
    expect(new Set(first.map((p) => p.offsetX)).size).toBe(9);
  });
});

describe('组任务不进矩阵', () => {
  it('图和四象限清单里都没有组任务', () => {
    const result = layout([
      task('mine', { deadlineAt: sh('2026-09-25T09:00:00'), importanceLevel: 4 }),
      task('group', { deadlineAt: sh('2026-09-25T09:00:00'), groupId: 'g1' }),
    ]);
    expect(result.points.map((p) => p.task.id)).toEqual(['mine']);
  });
});

describe('groupPointsByQuadrant', () => {
  const tasks = [
    task('a', { deadlineAt: sh('2026-09-27T09:00:00'), importanceLevel: 4 }), // N = 4
    task('b', { deadlineAt: sh('2026-09-25T09:00:00'), importanceLevel: 5 }), // N = 2
    task('c', { importanceLevel: 1, deadlineAt: sh('2026-12-01T09:00:00') }), // N = 69
  ];

  it('按象限分组，组内按截止时间从近到远（长期：N ≤ 14 紧急）', () => {
    const groups = groupPointsByQuadrant(layout(tasks, 'long').points);
    expect(groups.important_urgent.map((p) => p.task.id)).toEqual(['b', 'a']);
    expect(groups.not_important_not_urgent.map((p) => p.task.id)).toEqual(['c']);
    expect(groups.important_not_urgent).toEqual([]);
  });

  it('分组用当前模式的判定（短期：N ≤ 3 紧急）；清单里有哪些任务与模式无关', () => {
    const groups = groupPointsByQuadrant(layout(tasks, 'short').points);
    expect(groups.important_urgent.map((p) => p.task.id)).toEqual(['b']);
    expect(groups.important_not_urgent.map((p) => p.task.id)).toEqual(['a']);
    // c 超出短期范围，图上不画，但仍在清单里
    expect(groups.not_important_not_urgent.map((p) => [p.task.id, p.slot])).toEqual([['c', null]]);
  });
});
