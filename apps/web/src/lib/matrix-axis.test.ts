import { buildMatrixLayout, type Task } from '@alethego/core';
import { describe, expect, it } from 'vitest';

import { MIDLINE_BOUNDARY, X_TICKS, cellSideLabels } from './matrix-axis';

const timeZone = 'Asia/Shanghai';
const sh = (local: string) => new Date(`${local}+08:00`);
// 固定 now：2026-10-05 是周一，15:54（用户时区）
const context = { now: sh('2026-10-05T15:54:00'), timeZone };

const task = (id: string, deadlineAt: Date): Task => ({
  id,
  ownerId: 'u',
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

/** 某截止时间落在哪一格，以及这一格两侧画出的刻度名 */
function cellOf(deadlineAt: Date) {
  const { points } = buildMatrixLayout({ tasks: [task('t', deadlineAt)] }, context);
  expect(points).toHaveLength(1);
  const column = points[0]!.column;
  return { column, ...cellSideLabels(column) };
}

// 对照表：日期 → 这一格（左侧刻度名 – 右侧刻度名）；"1天以内"这一格右侧是逾期区，不标字
const table: [string, string, string | null, string | null][] = [
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
  ['再往后一周的周一', '2026-10-19', '三周', '两周'],
];

describe('矩阵横轴对照表（now = 周一 15:54）', () => {
  it.each(table)('%s → %s–%s', (_name, date, left, right) => {
    // 日期型（当天最后一刻）与设了具体时刻的任务落格完全相同，不看几点几分
    for (const time of ['23:59:59.999', '00:30:00', '16:00:00', '09:00:00']) {
      const deadline = sh(`${date}T${time}`);
      // 今天 09:00 与 00:30 已过点，属于逾期区，不在这张表里
      if (deadline.getTime() < context.now.getTime()) continue;
      expect(cellOf(deadline)).toMatchObject({ left, right });
    }
  });

  it('今天与明天相邻：今天在最右的普通格，明天在它左边一格', () => {
    const today = cellOf(sh('2026-10-05T23:59:59.999'));
    const tomorrow = cellOf(sh('2026-10-06T23:59:59.999'));
    expect(today.column).toBe(12);
    expect(tomorrow.column).toBe(11);
  });

  it('刻度名从右到左依次是 1天 … 一年，中线在"两周"上，左右各 7 格', () => {
    expect([...X_TICKS].reverse().map((tick) => tick.label)).toEqual([
      '1天',
      '2天',
      '3天',
      '5天',
      '一周',
      '两周',
      '三周',
      '一个月',
      '两个月',
      '一季度',
      '半年',
      '三个季度',
      '一年',
    ]);
    expect(MIDLINE_BOUNDARY).toBe(7);
    // 分界线 0..14：中线左边 7 格，右边 6 个普通格 + 逾期区 1 格
    expect(14 - MIDLINE_BOUNDARY).toBe(7);
  });
});
