import { describe, expect, it } from 'vitest';

import {
  BASE_TIER_DAYS,
  EXTENDED_TIER_DAYS,
  LAST_URGENT_TIER_INDEX,
  MAX_TIER_INDEX,
} from './tiers';
import { calculateUrgency, isUrgent, tierIndexForDays } from './urgency-calculator';

const timeZone = 'Asia/Shanghai';
// 2026-09-25 10:00 (Asia/Shanghai)
const now = new Date('2026-09-25T02:00:00Z');
const context = { now, timeZone };

/** 上海本地时间 → UTC 时间点 */
const sh = (local: string) => new Date(`${local}+08:00`);
/** 距 now 的精确时间点 */
const inDays = (days: number) => new Date(now.getTime() + days * 86_400_000);

describe('标尺', () => {
  it('自然天数，不再是斐波那契数', () => {
    expect(BASE_TIER_DAYS).toEqual([1, 2, 3, 5, 7, 14, 21, 30, 60, 90, 180, 270, 365]);
    expect(EXTENDED_TIER_DAYS).toEqual([730, 1095, 1825, 2555, 3650]);
    expect(MAX_TIER_INDEX).toBe(12);
    expect(BASE_TIER_DAYS[LAST_URGENT_TIER_INDEX]).toBe(14);
  });
});

describe('tierIndexForDays：区间 (a, b]，上界含在内', () => {
  it.each([
    [0.01, 0],
    [1, 0],
    [1.0001, 1],
    [2, 1],
    [3, 2],
    [4, 3],
    [5, 3],
    [6, 4],
    [7, 4],
    [7.5, 5],
    [14, 5],
    [14.1, 6],
    [21, 6],
    [30, 7],
    [45, 8],
    [90, 9],
    [180, 10],
    [270, 11],
    [365, 12],
  ])('%f 天 → 第 %i 档', (days, tier) => {
    expect(tierIndexForDays(days)).toBe(tier);
  });

  it('超过一年返回 null', () => {
    expect(tierIndexForDays(365.01)).toBeNull();
  });
});

describe('calculateUrgency：按剩余时间判档，不按日历天数', () => {
  it('无截止时间 → 最大档', () => {
    expect(calculateUrgency(null, context)).toEqual({ kind: 'no_deadline', tierIndex: 12 });
  });

  it('相隔 1 小时但跨过午夜：R = 1 小时 → (0,1] 档（不再因跨日算"明天"）', () => {
    const lateNight = { now: sh('2026-09-25T23:30:00'), timeZone };
    expect(calculateUrgency(sh('2026-09-26T00:30:00'), lateNight)).toMatchObject({
      kind: 'scheduled',
      tierIndex: 0,
    });
  });

  it('明天 09:00（R = 23 小时）→ (0,1]；明天全天（R ≈ 1.58 天）→ (1,2]', () => {
    expect(calculateUrgency(sh('2026-09-26T09:00:00'), context)).toMatchObject({ tierIndex: 0 });
    expect(calculateUrgency(sh('2026-09-26T23:59:59.999'), context)).toMatchObject({
      tierIndex: 1,
      tierDays: 2,
    });
  });

  it('恰好在分界上归入较近的一档（上界含在内）', () => {
    expect(calculateUrgency(inDays(14), context)).toMatchObject({ tierIndex: 5, tierDays: 14 });
    expect(calculateUrgency(inDays(14 + 1 / 1440), context)).toMatchObject({ tierIndex: 6 });
    expect(calculateUrgency(inDays(365), context)).toMatchObject({ tierIndex: 12 });
  });

  it('daysRemaining 是剩余时间折算的天数', () => {
    const urgency = calculateUrgency(inDays(2.5), context);
    expect(urgency).toMatchObject({ kind: 'scheduled', tierIndex: 2 });
    if (urgency.kind === 'scheduled') expect(urgency.daysRemaining).toBeCloseTo(2.5);
  });

  it('超过一年 → 扩展向量（自然值：两年、三年……十年）', () => {
    expect(calculateUrgency(inDays(380), context)).toMatchObject({
      kind: 'far',
      extendedTierDays: 730,
    });
    expect(calculateUrgency(inDays(1000), context)).toMatchObject({ extendedTierDays: 1095 });
  });

  it('超出扩展向量 → extendedTierDays 为 null', () => {
    expect(calculateUrgency(inDays(4000), context)).toMatchObject({
      kind: 'far',
      extendedTierDays: null,
    });
  });

  it('R ≤ 0 为逾期；当天稍早已过 → 逾期 0 天（逾期天数仍按日历天）', () => {
    expect(calculateUrgency(now, context)).toEqual({ kind: 'overdue', overdueDays: 0 });
    expect(calculateUrgency(sh('2026-09-25T09:00:00'), context)).toEqual({
      kind: 'overdue',
      overdueDays: 0,
    });
    expect(calculateUrgency(sh('2026-09-24T23:59:59.999'), context)).toEqual({
      kind: 'overdue',
      overdueDays: 1,
    });
  });

  it('逾期天数不封顶', () => {
    expect(calculateUrgency(sh('2026-01-01T09:00:00'), context)).toEqual({
      kind: 'overdue',
      overdueDays: 267,
    });
  });
});

describe('isUrgent：以两周为界', () => {
  it('R ≤ 14 天为紧急，R > 14 天不紧急', () => {
    expect(isUrgent(calculateUrgency(inDays(14), context))).toBe(true);
    expect(isUrgent(calculateUrgency(inDays(14.01), context))).toBe(false);
  });

  it('逾期为紧急，无截止时间与远期为不紧急', () => {
    expect(isUrgent({ kind: 'overdue', overdueDays: 10 })).toBe(true);
    expect(isUrgent({ kind: 'no_deadline', tierIndex: 12 })).toBe(false);
    expect(isUrgent({ kind: 'far', daysRemaining: 400, extendedTierDays: 730 })).toBe(false);
  });
});
