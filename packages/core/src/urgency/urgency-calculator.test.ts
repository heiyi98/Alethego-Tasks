import { describe, expect, it } from 'vitest';

import { EXTENDED_TIER_DAYS, MODE_TIER_DAYS, modeMaxDays, urgentThresholdDays } from './tiers';
import { calculateUrgency, cellForDayNumber, isUrgent } from './urgency-calculator';

const timeZone = 'Asia/Shanghai';
/** 上海本地时间 → UTC 时间点 */
const sh = (local: string) => new Date(`${local}+08:00`);
// 2026-10-05 是周一
const context = { now: sh('2026-10-05T15:54:00'), timeZone };

describe('标尺：短期、长期两种模式，各 6 格', () => {
  it('自然天数', () => {
    expect(MODE_TIER_DAYS.short).toEqual([1, 2, 3, 5, 7, 14]);
    expect(MODE_TIER_DAYS.long).toEqual([3, 7, 14, 30, 90, 180]);
    expect(EXTENDED_TIER_DAYS).toEqual([730, 1095, 1825, 2555, 3650]);
    expect(urgentThresholdDays('short')).toBe(3);
    expect(urgentThresholdDays('long')).toBe(14);
    expect(modeMaxDays('short')).toBe(14);
    expect(modeMaxDays('long')).toBe(180);
  });
});

describe('cellForDayNumber：从右往左第几格，N 的区间上界含在内', () => {
  it.each([
    [1, 0],
    [2, 1],
    [3, 2],
    [4, 3],
    [5, 3],
    [6, 4],
    [7, 4],
    [8, 5],
    [14, 5],
  ])('短期：N = %i → 第 %i 格', (n, cell) => {
    expect(cellForDayNumber(n, 'short')).toBe(cell);
  });

  it.each([
    [1, 0],
    [3, 0],
    [4, 1],
    [7, 1],
    [8, 2],
    [14, 2],
    [15, 3],
    [30, 3],
    [31, 4],
    [90, 4],
    [91, 5],
    [180, 5],
  ])('长期：N = %i → 第 %i 格', (n, cell) => {
    expect(cellForDayNumber(n, 'long')).toBe(cell);
  });

  it('超出模式范围返回 null：短期 N > 14，长期 N > 180', () => {
    expect(cellForDayNumber(15, 'short')).toBeNull();
    expect(cellForDayNumber(181, 'long')).toBeNull();
  });
});

describe('calculateUrgency：按日期判档，今天算第 1 天', () => {
  it('无截止日期', () => {
    expect(calculateUrgency(null, context)).toEqual({ kind: 'no_deadline' });
  });

  it('今天截止 N = 1，明天 N = 2（不管现在几点）', () => {
    expect(calculateUrgency('2026-10-05', context)).toMatchObject({ dayNumber: 1 });
    expect(calculateUrgency('2026-10-06', context)).toMatchObject({ dayNumber: 2 });
    const lateNight = { now: sh('2026-10-05T23:59:00'), timeZone };
    expect(calculateUrgency('2026-10-05', lateNight)).toMatchObject({
      kind: 'scheduled',
      dayNumber: 1,
    });
  });

  it('今天是哪一天按用户时区判断', () => {
    const nowUtc = new Date('2026-10-05T20:00:00Z'); // 上海已经是 10 月 6 日
    expect(calculateUrgency('2026-10-06', { now: nowUtc, timeZone: 'UTC' })).toMatchObject({
      dayNumber: 2,
    });
    expect(calculateUrgency('2026-10-06', { now: nowUtc, timeZone })).toMatchObject({
      dayNumber: 1,
    });
  });

  it('N > 365 → 扩展向量（两年、三年……十年）', () => {
    expect(calculateUrgency('2027-10-10', context)).toMatchObject({
      kind: 'far',
      extendedTierDays: 730,
    });
    expect(calculateUrgency('2040-01-01', context)).toMatchObject({
      kind: 'far',
      extendedTierDays: null,
    });
  });

  it('截止日期那一天过完才逾期：昨天截止 → 逾期 1 天', () => {
    expect(calculateUrgency('2026-10-04', context)).toEqual({ kind: 'overdue', overdueDays: 1 });
    expect(calculateUrgency('2026-10-03', context)).toEqual({ kind: 'overdue', overdueDays: 2 });
  });

  it('逾期天数不封顶', () => {
    expect(calculateUrgency('2026-01-01', context)).toEqual({ kind: 'overdue', overdueDays: 277 });
  });
});

describe('isUrgent：跟着矩阵模式，中线右边三格为紧急', () => {
  it('短期：N ≤ 3 为紧急，N = 4 不紧急', () => {
    expect(isUrgent(calculateUrgency('2026-10-07', context), 'short')).toBe(true); // N = 3
    expect(isUrgent(calculateUrgency('2026-10-08', context), 'short')).toBe(false); // N = 4
  });

  it('长期：N ≤ 14 为紧急，N = 15 不紧急', () => {
    expect(isUrgent(calculateUrgency('2026-10-18', context), 'long')).toBe(true); // N = 14
    expect(isUrgent(calculateUrgency('2026-10-19', context), 'long')).toBe(false); // N = 15
  });

  it('逾期为紧急，无截止日期与远期为不紧急（两种模式）', () => {
    for (const mode of ['short', 'long'] as const) {
      expect(isUrgent({ kind: 'overdue', overdueDays: 2 }, mode)).toBe(true);
      expect(isUrgent({ kind: 'no_deadline' }, mode)).toBe(false);
      expect(isUrgent({ kind: 'far', dayNumber: 400, extendedTierDays: 730 }, mode)).toBe(false);
    }
  });
});
