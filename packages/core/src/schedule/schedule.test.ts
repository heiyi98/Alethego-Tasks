import { describe, expect, it } from 'vitest';

import { addDays, dateOfInstant, daysBetween, endOfDate, latestDate } from './calendar-date';
import { computeFloat, type PlanItem, type PlanLink } from './critical-path';
import { findCycle, topologicalOrder, wouldCreateCycle } from './relation-cycles';
import {
  computeScheduleDates,
  isMilestone,
  scheduleSpecOf,
  type ScheduleSpec,
  type ScheduledDates,
  type TaskRelation,
} from './schedule-dates';
import { waitingOn, type WaitingContext, type WaitingTask } from './waiting';

const base: ScheduleSpec = {
  startOn: null,
  startRelations: [],
  endMode: 'date',
  endOn: null,
  endAfterDays: null,
  endRelations: [],
};

const others: Record<string, ScheduledDates> = {
  A: { start: '2026-10-01', end: '2026-10-05' },
  B: { start: '2026-10-03', end: '2026-10-08' },
  M: { start: null, end: '2026-10-10' },
  N: { start: null, end: null },
};
const datesOf = (id: string) => others[id];

describe('日历日', () => {
  it('加减天数、相差天数、跨月跨年', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(daysBetween('2026-02-27', '2026-03-01')).toBe(2);
    expect(latestDate(['2026-10-01', null, '2026-12-01'])).toBe('2026-12-01');
    expect(latestDate([null])).toBeNull();
  });

  it('时间点所在的日期按时区算；当天最后一刻', () => {
    const instant = new Date('2026-10-05T16:30:00Z');
    expect(dateOfInstant(instant, 'Asia/Shanghai')).toBe('2026-10-06');
    expect(dateOfInstant(instant, 'America/Los_Angeles')).toBe('2026-10-05');
    expect(endOfDate('2026-10-06', 'Asia/Shanghai').toISOString()).toBe('2026-10-06T15:59:59.999Z');
    // 夏令时开始的那一天（纽约 2026-03-08 只有 23 小时）
    expect(endOfDate('2026-03-08', 'America/New_York').toISOString()).toBe(
      '2026-03-09T03:59:59.999Z',
    );
  });
});

describe('两行逻辑的日期推算', () => {
  it('四种关系：于对方的开始 / 结束，挂在自己的开始 / 结束上', () => {
    const at = (anchor: 'start' | 'end') => [{ predecessorId: 'A', anchor, offsetDays: 0 }];
    expect(computeScheduleDates({ ...base, startRelations: at('start') }, datesOf).start).toBe(
      '2026-10-01',
    );
    expect(computeScheduleDates({ ...base, startRelations: at('end') }, datesOf).start).toBe(
      '2026-10-05',
    );
    const endMode = { ...base, endMode: 'relations' as const };
    expect(computeScheduleDates({ ...endMode, endRelations: at('start') }, datesOf).end).toBe(
      '2026-10-01',
    );
    expect(computeScheduleDates({ ...endMode, endRelations: at('end') }, datesOf).end).toBe(
      '2026-10-05',
    );
  });

  it('偏移：后 N 天、前 N 天', () => {
    const spec = (offsetDays: number) => ({
      ...base,
      startRelations: [{ predecessorId: 'A', anchor: 'end' as const, offsetDays }],
    });
    expect(computeScheduleDates(spec(3), datesOf).start).toBe('2026-10-08');
    expect(computeScheduleDates(spec(-2), datesOf).start).toBe('2026-10-03');
  });

  it('多个关系取最晚；没有日期的关系对象不算；一个都算不出来时为空', () => {
    const spec = {
      ...base,
      startRelations: [
        { predecessorId: 'A', anchor: 'end' as const, offsetDays: 0 },
        { predecessorId: 'B', anchor: 'start' as const, offsetDays: 1 },
        { predecessorId: 'N', anchor: 'end' as const, offsetDays: 30 },
      ],
    };
    expect(computeScheduleDates(spec, datesOf).start).toBe('2026-10-05');
    expect(
      computeScheduleDates(
        { ...base, startRelations: [{ predecessorId: 'N', anchor: 'end', offsetDays: 0 }] },
        datesOf,
      ).start,
    ).toBeNull();
  });

  it('对方没有开始（里程碑）：它的开始按结束日期算', () => {
    expect(
      computeScheduleDates(
        { ...base, startRelations: [{ predecessorId: 'M', anchor: 'start', offsetDays: 0 }] },
        datesOf,
      ).start,
    ).toBe('2026-10-10');
  });

  it('开始后 N 天；开始为空时结束也为空；固定日期原样', () => {
    expect(
      computeScheduleDates(
        { ...base, startOn: '2026-10-02', endMode: 'after_start', endAfterDays: 4 },
        datesOf,
      ),
    ).toEqual({ start: '2026-10-02', end: '2026-10-06' });
    expect(
      computeScheduleDates({ ...base, endMode: 'after_start', endAfterDays: 4 }, datesOf).end,
    ).toBeNull();
    expect(
      computeScheduleDates(
        {
          ...base,
          startRelations: [{ predecessorId: 'B', anchor: 'end', offsetDays: 1 }],
          endMode: 'after_start',
          endAfterDays: 0,
        },
        datesOf,
      ),
    ).toEqual({ start: '2026-10-09', end: '2026-10-09' });
    expect(computeScheduleDates({ ...base, endOn: '2026-12-01' }, datesOf).end).toBe('2026-12-01');
  });

  it('里程碑：开始和结束同一天，或者只有结束', () => {
    expect(isMilestone({ start: '2026-10-01', end: '2026-10-01' })).toBe(true);
    expect(isMilestone({ start: null, end: '2026-10-01' })).toBe(true);
    expect(isMilestone({ start: '2026-10-01', end: '2026-10-02' })).toBe(false);
    expect(isMilestone({ start: '2026-10-01', end: null })).toBe(false);
  });

  it('从存下来的关系还原两行逻辑', () => {
    const relations: TaskRelation[] = [
      { taskId: 'T', side: 'start', predecessorId: 'A', anchor: 'end', offsetDays: 1 },
      { taskId: 'T', side: 'end', predecessorId: 'B', anchor: 'end', offsetDays: 0 },
    ];
    expect(scheduleSpecOf({ startOn: null, endAfterDays: null }, null, relations)).toMatchObject({
      endMode: 'relations',
      startRelations: [{ predecessorId: 'A', anchor: 'end', offsetDays: 1 }],
    });
    expect(scheduleSpecOf({ startOn: '2026-10-01', endAfterDays: 3 }, null, []).endMode).toBe(
      'after_start',
    );
    expect(scheduleSpecOf({ startOn: null, endAfterDays: null }, '2026-10-01', []).endMode).toBe(
      'date',
    );
  });
});

describe('循环检测', () => {
  const edges = [
    { taskId: 'B', predecessorId: 'A' },
    { taskId: 'C', predecessorId: 'B' },
  ];
  it('A 等 B、B 又等 A 不行；隔几层也不行；自己不能等自己', () => {
    expect(wouldCreateCycle(edges, 'A', 'B')).toBe(true);
    expect(wouldCreateCycle(edges, 'A', 'C')).toBe(true);
    expect(wouldCreateCycle(edges, 'A', 'A')).toBe(true);
    expect(wouldCreateCycle(edges, 'C', 'A')).toBe(false);
    expect(wouldCreateCycle(edges, 'D', 'C')).toBe(false);
  });

  it('找出循环；拓扑顺序', () => {
    expect(findCycle(edges)).toBeNull();
    expect(findCycle([...edges, { taskId: 'A', predecessorId: 'C' }])?.sort()).toEqual([
      'A',
      'B',
      'C',
    ]);
    expect(topologicalOrder(['C', 'B', 'A'], edges)).toEqual(['A', 'B', 'C']);
    expect(() =>
      topologicalOrder(['A', 'B'], [...edges, { taskId: 'A', predecessorId: 'B' }]),
    ).toThrow();
  });
});

describe('浮动时间和关键路径', () => {
  // A(10/1–10/3) → B 开始于 A 结束 +1（10/4–10/8）；C 开始于 A 结束（10/3–10/4）
  const items: PlanItem[] = [
    { id: 'A', start: '2026-10-01', end: '2026-10-03' },
    { id: 'B', start: '2026-10-04', end: '2026-10-08' },
    { id: 'C', start: '2026-10-03', end: '2026-10-04' },
  ];
  const links: PlanLink[] = [
    { from: 'A', anchor: 'end', to: 'B', side: 'start', offsetDays: 1 },
    { from: 'A', anchor: 'end', to: 'C', side: 'start', offsetDays: 0 },
  ];

  it('终点是最晚的结束；浮动 = 最晚结束 − 结束；浮动为 0 的在关键路径上', () => {
    const result = computeFloat(items, links);
    expect(result.projectEnd).toBe('2026-10-08');
    expect(Object.fromEntries(result.floatDays)).toEqual({ A: 0, B: 0, C: 4 });
    expect([...result.critical].sort()).toEqual(['A', 'B']);
  });

  it('依赖对方的开始：对方的最晚开始 = 最晚结束 − 工期', () => {
    // D 的结束于 B 的开始 −1：D 最晚 10/3 结束
    const result = computeFloat(
      [...items, { id: 'D', start: '2026-09-30', end: '2026-10-01' }],
      [...links, { from: 'D', anchor: 'end', to: 'B', side: 'start', offsetDays: 1 }],
    );
    expect(result.floatDays.get('D')).toBe(2);
    // E 的开始挂在 B 的结束上：E 是从 B 结束才开始的里程碑
    const withStart = computeFloat(
      [...items, { id: 'E', start: '2026-10-01', end: '2026-10-02' }],
      [{ from: 'E', anchor: 'start', to: 'B', side: 'end', offsetDays: 0 }],
    );
    // E 的开始最晚 10/8（B 的最晚结束），工期 1 天 → 最晚结束 10/9，但不超过终点 10/8
    expect(withStart.floatDays.get('E')).toBe(6);
  });

  it('范围外的关系不算；没有任务时没有终点', () => {
    expect(
      computeFloat(items, [
        { from: 'X', anchor: 'end', to: 'A', side: 'start', offsetDays: 0 },
      ]).floatDays.get('A'),
    ).toBe(5);
    expect(computeFloat([], []).projectEnd).toBeNull();
  });
});

describe('等待', () => {
  const task = (id: string, patch: Partial<WaitingTask> = {}): WaitingTask => ({
    id,
    startOn: null,
    confirmedAt: null,
    ...patch,
  });
  const rel = (
    taskId: string,
    side: 'start' | 'end',
    predecessorId: string,
    anchor: 'start' | 'end',
  ): TaskRelation => ({ taskId, side, predecessorId, anchor, offsetDays: 0 });
  const context = (tasks: WaitingTask[], relations: TaskRelation[], today = '2026-10-05') => {
    const relationsByTask = new Map<string, TaskRelation[]>();
    for (const r of relations)
      relationsByTask.set(r.taskId, [...(relationsByTask.get(r.taskId) ?? []), r]);
    return {
      tasks: new Map(tasks.map((t) => [t.id, t])),
      relationsByTask,
      today,
    } satisfies WaitingContext;
  };

  it('等对方结束：看对方是否已确认完成', () => {
    const ctx = context([task('A'), task('T')], [rel('T', 'start', 'A', 'end')]);
    expect(waitingOn('T', ctx)).toEqual([{ predecessorId: 'A', anchor: 'end' }]);
    const done = context(
      [task('A', { confirmedAt: new Date() }), task('T')],
      [rel('T', 'start', 'A', 'end')],
    );
    expect(waitingOn('T', done)).toEqual([]);
  });

  it('等对方开始：固定日期看是否到了那天；没有开始条件算已开始', () => {
    const ctx = (startOn: string | null) =>
      context([task('A', { startOn }), task('T')], [rel('T', 'start', 'A', 'start')]);
    expect(waitingOn('T', ctx('2026-10-06'))).toHaveLength(1);
    expect(waitingOn('T', ctx('2026-10-05'))).toEqual([]);
    expect(waitingOn('T', ctx(null))).toEqual([]);
  });

  it('等对方开始、对方的开始又是关系：逐层往上判断', () => {
    // T 等 A 开始；A 的开始等 B 结束；B 的开始等 C 开始（C 固定 10/10 还没到）
    const tasks = [task('A'), task('B'), task('C', { startOn: '2026-10-10' }), task('T')];
    const relations = [
      rel('T', 'start', 'A', 'start'),
      rel('A', 'start', 'B', 'end'),
      rel('B', 'start', 'C', 'start'),
    ];
    expect(waitingOn('T', context(tasks, relations))).toEqual([
      { predecessorId: 'A', anchor: 'start' },
    ]);
    // B 完成了 → A 可以开始 → T 不再等待
    tasks[1] = task('B', { confirmedAt: new Date() });
    expect(waitingOn('T', context(tasks, relations))).toEqual([]);
    // A 的开始等 C 的开始：C 到了 10/10 才算
    const viaStart = [rel('T', 'start', 'A', 'start'), rel('A', 'start', 'C', 'start')];
    expect(waitingOn('T', context(tasks, viaStart))).toHaveLength(1);
    expect(waitingOn('T', context(tasks, viaStart, '2026-10-10'))).toEqual([]);
  });

  it('多个对象：先列开始那一行的；已完成的任务不在等待；已删除的对象不挡人', () => {
    const tasks = [task('A'), task('B'), task('D', { deletedAt: new Date() }), task('T')];
    const relations = [
      rel('T', 'end', 'B', 'end'),
      rel('T', 'start', 'A', 'end'),
      rel('T', 'start', 'D', 'end'),
    ];
    expect(waitingOn('T', context(tasks, relations)).map((w) => w.predecessorId)).toEqual([
      'A',
      'B',
    ]);
    // 只看开始那一行（简介行）：结束那一行的 B 不算
    expect(
      waitingOn('T', context(tasks, relations), ['start']).map((w) => w.predecessorId),
    ).toEqual(['A']);
    expect(
      waitingOn(
        'T',
        context([...tasks.slice(0, 3), task('T', { confirmedAt: new Date() })], relations),
      ),
    ).toEqual([]);
  });
});
