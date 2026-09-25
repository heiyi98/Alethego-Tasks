import { describe, expect, it } from 'vitest';

import type { Task } from '../domain/task';
import {
  OVERDUE_COLUMN,
  buildMatrixLayout,
  columnForUrgency,
  groupPointsByQuadrant,
} from './matrix-layout';

const timeZone = 'Asia/Shanghai';
const sh = (local: string) => new Date(`${local}+08:00`);
const context = { now: sh('2026-09-24T10:00:00'), timeZone }; // 周四

let seq = 0;
const task = (id: string, fields: Partial<Task> = {}): Task => ({
  id,
  ownerId: 'u',
  title: id,
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

const layout = (tasks: Task[]) => buildMatrixLayout({ tasks }, context);
const pointOf = (tasks: Task[], id: string) => layout(tasks).points.find((p) => p.task.id === id);

describe('columnForUrgency', () => {
  it('越紧急越靠右；无截止时间在最左列；逾期在贴边列；远期不上矩阵', () => {
    expect(
      columnForUrgency({ kind: 'scheduled', daysRemaining: 0, tierIndex: 0, tierDays: 0 }),
    ).toBe(13);
    expect(
      columnForUrgency({ kind: 'scheduled', daysRemaining: 300, tierIndex: 13, tierDays: 377 }),
    ).toBe(0);
    expect(columnForUrgency({ kind: 'no_deadline', tierIndex: 13 })).toBe(0);
    expect(columnForUrgency({ kind: 'overdue', overdueDays: 1 })).toBe(OVERDUE_COLUMN);
    expect(columnForUrgency({ kind: 'far', daysRemaining: 500, extendedTierDays: 610 })).toBeNull();
  });
});

describe('buildMatrixLayout', () => {
  it('按紧迫度列与重要性行放置，并给出象限', () => {
    const tasks = [
      task('tomorrow-5', { deadlineAt: sh('2026-09-25T09:00:00'), importanceLevel: 5 }),
      task('month-1', { deadlineAt: sh('2026-10-24T09:00:00'), importanceLevel: 1 }),
      task('nodeadline-3', { importanceLevel: 3 }),
    ];
    expect(pointOf(tasks, 'tomorrow-5')).toMatchObject({
      column: 12,
      row: 5,
      quadrant: 'important_urgent',
      overdueDays: null,
    });
    expect(pointOf(tasks, 'month-1')).toMatchObject({
      column: 13 - 8,
      row: 1,
      quadrant: 'not_important_not_urgent',
    });
    expect(pointOf(tasks, 'nodeadline-3')).toMatchObject({
      column: 0,
      row: 3,
      quadrant: 'important_not_urgent',
    });
  });

  it('重要性为 0 但有截止时间 → 最下一行，照常上矩阵', () => {
    const tasks = [task('t', { deadlineAt: sh('2026-09-24T20:00:00') })];
    expect(pointOf(tasks, 't')).toMatchObject({ column: 13, row: 0 });
  });

  it('逾期 3 天内贴边并标注天数；之后退场', () => {
    const tasks = [
      task('late-2', { deadlineAt: sh('2026-09-22T09:00:00'), importanceLevel: 2 }),
      task('late-5', { deadlineAt: sh('2026-09-19T09:00:00'), importanceLevel: 2 }),
    ];
    const result = layout(tasks);
    expect(result.points.map((p) => p.task.id)).toEqual(['late-2']);
    expect(result.points[0]).toMatchObject({ column: OVERDUE_COLUMN, overdueDays: 2 });
    expect(result.hidden.overdue_expired).toBe(1);
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
    expect(point).toMatchObject({ column: 12, row: 4, quadrant: 'important_urgent' });
    expect(point?.representative.occurrenceAt).toEqual(sh('2026-09-25T07:00:00'));
  });

  it('同一格子内的点互不重叠、留在格内，且位置稳定', () => {
    const tasks = Array.from({ length: 9 }, (_, i) =>
      task(`same-${i}`, { deadlineAt: sh('2026-09-25T09:00:00'), importanceLevel: 4 }),
    );
    const first = layout(tasks).points;
    expect(new Set(first.map((p) => `${p.column}:${p.row}`)).size).toBe(1);

    for (const p of first) {
      expect(p.offsetX).toBeGreaterThan(0.1);
      expect(p.offsetX).toBeLessThan(0.9);
      expect(p.offsetY).toBeGreaterThan(0.1);
      expect(p.offsetY).toBeLessThan(0.9);
    }
    // 9 个点切成 3×3 子格，子格宽约 0.24；两点中心距离应明显大于 0（不重叠）
    for (let i = 0; i < first.length; i++) {
      for (let j = i + 1; j < first.length; j++) {
        const dx = first[i]!.offsetX - first[j]!.offsetX;
        const dy = first[i]!.offsetY - first[j]!.offsetY;
        expect(Math.hypot(dx, dy)).toBeGreaterThan(0.1);
      }
    }

    // 输入顺序不同，布局相同
    const again = layout([...tasks].reverse()).points;
    const byId = new Map(again.map((p) => [p.task.id, p]));
    for (const p of first) {
      expect(byId.get(p.task.id)).toMatchObject({ offsetX: p.offsetX, offsetY: p.offsetY });
    }
  });
});

describe('groupPointsByQuadrant', () => {
  it('按象限分组，组内按截止时间从近到远', () => {
    const { points } = layout([
      task('a', { deadlineAt: sh('2026-09-27T09:00:00'), importanceLevel: 4 }),
      task('b', { deadlineAt: sh('2026-09-25T09:00:00'), importanceLevel: 5 }),
      task('c', { importanceLevel: 1, deadlineAt: sh('2026-12-01T09:00:00') }),
    ]);
    const groups = groupPointsByQuadrant(points);
    expect(groups.important_urgent.map((p) => p.task.id)).toEqual(['b', 'a']);
    expect(groups.not_important_not_urgent.map((p) => p.task.id)).toEqual(['c']);
    expect(groups.important_not_urgent).toEqual([]);
  });
});
