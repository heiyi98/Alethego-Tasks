import { buildMatrixLayout, type MatrixMode, type Task } from '@alethego/core';
import { describe, expect, it } from 'vitest';

import { MIDLINE_BOUNDARY, cellSideLabels, xTicks } from './matrix-axis';

const timeZone = 'Asia/Shanghai';
const sh = (local: string) => new Date(`${local}+08:00`);
// 固定 now：2026-10-05 是周一，15:54（用户时区）
const context = { now: sh('2026-10-05T15:54:00'), timeZone };

const task = (id: string, deadlineAt: Date | null): Task => ({
  id,
  ownerId: 'u',
  groupId: null,
  title: id,
  description: '',
  deadlineAt,
  importanceLevel: 3,
  recurrenceRule: null,
  recurrenceDtstart: null,
  completedAt: null,
  isStarred: false,
  createdAt: sh('2026-10-01T00:00:00'),
  updatedAt: sh('2026-10-01T00:00:00'),
  deletedAt: null,
});

/** 某截止时间在某种模式下落在哪一格，以及这一格两侧画出的刻度名；不显示返回 null */
function cellOf(deadlineAt: Date, mode: MatrixMode) {
  const { points } = buildMatrixLayout({ tasks: [task('t', deadlineAt)] }, context, mode);
  expect(points).toHaveLength(1);
  const slot = points[0]!.slot;
  if (slot === null) return null;
  expect(slot.kind).toBe('cell');
  const column = slot.kind === 'cell' ? slot.column : -1;
  return { column, ...cellSideLabels(mode, column) };
}

/** 日期型（当天最后一刻）与设了具体时刻的任务落格完全相同，不看几点几分 */
function expectCell(mode: MatrixMode, date: string, expected: object | null) {
  for (const time of ['23:59:59.999', '00:30:00', '16:00:00', '09:00:00']) {
    const deadline = sh(`${date}T${time}`);
    // 今天 09:00 与 00:30 已过点，属于逾期区，不在这张表里
    if (deadline.getTime() < context.now.getTime()) continue;
    const cell = cellOf(deadline, mode);
    if (expected === null) expect(cell).toBeNull();
    else expect(cell).toMatchObject(expected);
  }
}

/** 2026-10-05 起第 n 天（今天 n = 1）的日期 */
const dayN = (n: number) => {
  const d = new Date(Date.UTC(2026, 9, 5 + n - 1));
  return d.toISOString().slice(0, 10);
};

// 短期对照表：日期 → 这一格（左侧刻度名 – 右侧刻度名）；"1天以内"这一格右侧是逾期区，不标字
const shortTable: [string, string, string | null, string | null][] = [
  ['周一（今天）', '2026-10-05', '1天', null],
  ['周二', '2026-10-06', '2天', '1天'],
  ['周三', '2026-10-07', '3天', '2天'],
  ['周四', '2026-10-08', '5天', '3天'],
  ['周五', '2026-10-09', '5天', '3天'],
  ['周六', '2026-10-10', '一周', '5天'],
  ['周日', '2026-10-11', '一周', '5天'],
  ['下周一', '2026-10-12', '两周', '一周'],
  ['下周二', '2026-10-13', '两周', '一周'],
  ['下周三', '2026-10-14', '两周', '一周'],
  ['下周四', '2026-10-15', '两周', '一周'],
  ['下周五', '2026-10-16', '两周', '一周'],
  ['下周六', '2026-10-17', '两周', '一周'],
  ['下周日', '2026-10-18', '两周', '一周'],
];

describe('短期模式对照表（now = 周一 15:54）', () => {
  it.each(shortTable)('%s → %s–%s', (_name, date, left, right) => {
    expectCell('short', date, { left, right });
  });

  it('再往后的不显示（只进四象限清单）', () => {
    expectCell('short', '2026-10-19', null);
    expectCell('short', '2026-11-30', null);
  });

  it('今天在最右的普通格，明天在它左边一格', () => {
    expect(cellOf(sh('2026-10-05T23:59:59.999'), 'short')!.column).toBe(5);
    expect(cellOf(sh('2026-10-06T23:59:59.999'), 'short')!.column).toBe(4);
  });
});

describe('长期模式对照表（now = 周一 15:54）', () => {
  const longTable: [string, number[], string | null, string | null][] = [
    ['周一到周三', [1, 2, 3], '3天', null],
    ['周四到周日', [4, 5, 6, 7], '一周', '3天'],
    ['下周一到下周日', [8, 9, 10, 11, 12, 13, 14], '两周', '一周'],
    ['第 15–30 天', [15, 20, 30], '一个月', '两周'],
    ['第 31–90 天', [31, 60, 90], '一季度', '一个月'],
    ['第 91–180 天', [91, 150, 180], '半年', '一季度'],
  ];
  it.each(longTable)('%s → %s', (_name, days, left, right) => {
    for (const n of days) expectCell('long', dayN(n), { left, right });
  });

  it('第 1–7 天用日期核对：周一、周三、周四、周日', () => {
    expect(dayN(1)).toBe('2026-10-05');
    expect(dayN(3)).toBe('2026-10-07');
    expect(dayN(4)).toBe('2026-10-08');
    expect(dayN(7)).toBe('2026-10-11');
    expect(dayN(8)).toBe('2026-10-12');
  });

  it('更远的不显示（只进四象限清单）', () => {
    expectCell('long', dayN(181), null);
    expectCell('long', dayN(365), null);
  });
});

describe('刻度', () => {
  it('短期从左到右：两周、一周、5天、3天（中线）、2天、1天', () => {
    expect(xTicks('short').map((t) => t.label)).toEqual([
      '两周',
      '一周',
      '5天',
      '3天',
      '2天',
      '1天',
    ]);
    expect(xTicks('short')[MIDLINE_BOUNDARY]!.label).toBe('3天');
  });

  it('长期从左到右：半年、一季度、一个月、两周（中线）、一周、3天', () => {
    expect(xTicks('long').map((t) => t.label)).toEqual([
      '半年',
      '一季度',
      '一个月',
      '两周',
      '一周',
      '3天',
    ]);
    expect(xTicks('long')[MIDLINE_BOUNDARY]!.label).toBe('两周');
  });

  it('中线在 6 格正中，两种模式相同', () => {
    expect(MIDLINE_BOUNDARY).toBe(3);
  });
});

describe('没设截止日期但有重要性的任务', () => {
  it.each(['short', 'long'] as const)('%s：贴在最左边缘', (mode) => {
    const { points } = buildMatrixLayout({ tasks: [task('t', null)] }, context, mode);
    expect(points[0]!.slot).toEqual({ kind: 'no_deadline' });
  });
});
