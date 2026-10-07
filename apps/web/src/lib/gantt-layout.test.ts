import type { Task, TaskRelation } from '@alethego/core';
import { describe, expect, it } from 'vitest';

import { buildGantt, dayLineX, dayLines, ganttTicks, ganttWidth } from './gantt-layout';

const task = (id: string, patch: Partial<Task> = {}): Task => ({
  id,
  ownerId: 'u',
  groupId: 'g',
  projectId: 'p',
  startOn: null,
  endAfterDays: null,
  title: id,
  description: '',
  deadlineAt: null,
  importanceLevel: 0,
  recurrenceRule: null,
  recurrenceDtstart: null,
  completedAt: null,
  confirmedAt: null,
  isStarred: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  ...patch,
});
const end = (date: string) => new Date(`${date}T23:59:59.999+08:00`);

describe('甘特图的排布', () => {
  const tasks = [
    task('B', { startOn: '2026-10-04', deadlineAt: end('2026-10-08') }),
    task('A', { startOn: '2026-10-01', deadlineAt: end('2026-10-03') }),
    task('M', { deadlineAt: end('2026-10-06') }),
    task('N'),
    task('S', { startOn: '2026-10-05' }),
    task('D', { startOn: '2026-10-02', deadlineAt: end('2026-10-02'), completedAt: new Date() }),
  ];
  const relations = new Map<string, TaskRelation[]>([
    ['B', [{ taskId: 'B', side: 'start', predecessorId: 'A', anchor: 'end', offsetDays: 1 }]],
    ['M', [{ taskId: 'M', side: 'end', predecessorId: 'X', anchor: 'end', offsetDays: 0 }]],
  ]);
  const layout = buildGantt({
    tasks,
    scopeTasks: tasks,
    relationsByTask: relations,
    timeZone: 'Asia/Shanghai',
    today: '2026-10-02',
  });

  it('按开始日期排序；开始和结束同一天、只有开始、只有结束的是菱形；两个都没有的进未排期', () => {
    expect(layout.rows.map((r) => r.task.id)).toEqual(['A', 'D', 'B', 'S', 'M']);
    expect(layout.rows.map((r) => r.milestone)).toEqual([false, true, false, true, true]);
    expect(layout.unscheduled.map((t) => t.id)).toEqual(['N']);
  });

  it('状态、关键路径、浮动时间；只画两端都在图上的关系', () => {
    const byId = Object.fromEntries(layout.rows.map((r) => [r.task.id, r]));
    expect(byId.D!.status).toBe('pending');
    expect(byId.A!.critical && byId.B!.critical).toBe(true);
    expect(byId.M!.float).toBe(2);
    expect(layout.links).toHaveLength(1);
    expect(layout.from <= '2026-09-29' && layout.to >= '2026-10-08').toBe(true);
  });

  it('每一天是一条线：同一天结束和开始的任务落在同一条线上；线离两边各半天', () => {
    const from = '2026-10-01';
    const w = 40;
    expect(dayLineX(from, from, w)).toBe(20);
    expect(dayLineX('2026-10-03', from, w) - dayLineX(from, from, w)).toBe(80);
    expect(ganttWidth(from, '2026-10-03', w)).toBe(120);
    const lines = dayLines('2026-09-28', '2026-10-06');
    expect(lines).toHaveLength(9);
    expect(lines.filter((l) => l.kind === 'month').map((l) => l.date)).toEqual(['2026-10-01']);
    expect(lines.filter((l) => l.kind === 'week').map((l) => l.date)).toEqual([
      '2026-09-28',
      '2026-10-05',
    ]);
  });

  it('刻度：日（每天）、周（每周一）、月（每月 1 日）', () => {
    expect(ganttTicks('2026-09-29', '2026-10-06', 'day').minor.map((t) => t.label)).toEqual([
      '29',
      '30',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ]);
    expect(ganttTicks('2026-09-29', '2026-10-13', 'week').minor.map((t) => t.label)).toEqual([
      '10/5',
      '10/12',
    ]);
    expect(ganttTicks('2026-09-29', '2026-12-02', 'month').minor.map((t) => t.label)).toEqual([
      '9月',
      '10月',
      '11月',
      '12月',
    ]);
  });
});
