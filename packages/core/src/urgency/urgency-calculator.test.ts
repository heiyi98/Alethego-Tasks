import { describe, expect, it } from 'vitest';

import { calculateUrgency, isUrgent, tierIndexForDays } from './urgency-calculator';

const timeZone = 'Asia/Shanghai';
// 2026-09-25 10:00 (Asia/Shanghai)
const now = new Date('2026-09-25T02:00:00Z');
const context = { now, timeZone };

/** 上海本地时间 → UTC 时间点 */
const sh = (local: string) => new Date(`${local}+08:00`);

describe('tierIndexForDays', () => {
  it.each([
    [0, 0],
    [1, 1],
    [3, 3],
    [4, 4],
    [5, 4],
    [6, 5],
    [13, 6],
    [14, 7],
    [377, 13],
  ])('%i 天 → 第 %i 档', (days, tier) => {
    expect(tierIndexForDays(days)).toBe(tier);
  });

  it('超过一年返回 null', () => {
    expect(tierIndexForDays(378)).toBeNull();
  });
});

describe('calculateUrgency', () => {
  it('无截止时间 → 最大档', () => {
    expect(calculateUrgency(null, context)).toEqual({ kind: 'no_deadline', tierIndex: 13 });
  });

  it('今天稍晚截止 → 第 0 档', () => {
    expect(calculateUrgency(sh('2026-09-25T23:59:00'), context)).toMatchObject({
      kind: 'scheduled',
      daysRemaining: 0,
      tierIndex: 0,
    });
  });

  it('剩 4 天 → 第 4 档（五天内）', () => {
    expect(calculateUrgency(sh('2026-09-29T08:00:00'), context)).toMatchObject({
      kind: 'scheduled',
      daysRemaining: 4,
      tierIndex: 4,
      tierDays: 5,
    });
  });

  it('按日历日而非 24 小时计算：相隔 1 小时但跨过午夜算明天', () => {
    const lateNight = { now: sh('2026-09-25T23:30:00'), timeZone };
    expect(calculateUrgency(sh('2026-09-26T00:30:00'), lateNight)).toMatchObject({
      daysRemaining: 1,
      tierIndex: 1,
    });
  });

  it('同一时间点在不同时区可能落在不同日历日', () => {
    const deadline = new Date('2026-09-25T20:00:00Z');
    const nowUtc = new Date('2026-09-25T10:00:00Z');
    expect(calculateUrgency(deadline, { now: nowUtc, timeZone: 'UTC' })).toMatchObject({
      daysRemaining: 0,
    });
    expect(calculateUrgency(deadline, { now: nowUtc, timeZone })).toMatchObject({
      daysRemaining: 1,
    });
  });

  it('超过一年 → 扩展向量', () => {
    expect(calculateUrgency(sh('2027-10-10T10:00:00'), context)).toEqual({
      kind: 'far',
      daysRemaining: 380,
      extendedTierDays: 610,
    });
  });

  it('超出扩展向量 → extendedTierDays 为 null', () => {
    expect(calculateUrgency(sh('2040-01-01T00:00:00'), context)).toMatchObject({
      kind: 'far',
      extendedTierDays: null,
    });
  });

  it('当天稍早已过截止时间 → 逾期 0 天', () => {
    expect(calculateUrgency(sh('2026-09-25T09:00:00'), context)).toEqual({
      kind: 'overdue',
      overdueDays: 0,
    });
  });

  it('逾期天数不封顶', () => {
    expect(calculateUrgency(sh('2026-01-01T09:00:00'), context)).toEqual({
      kind: 'overdue',
      overdueDays: 267,
    });
  });
});

describe('isUrgent', () => {
  it('第 6 档（两周内）为紧急区最后一格，第 7 档起不紧急', () => {
    expect(isUrgent(calculateUrgency(sh('2026-10-08T10:00:00'), context))).toBe(true); // 13 天
    expect(isUrgent(calculateUrgency(sh('2026-10-09T10:00:00'), context))).toBe(false); // 14 天
  });

  it('逾期为紧急，无截止时间与远期为不紧急', () => {
    expect(isUrgent({ kind: 'overdue', overdueDays: 10 })).toBe(true);
    expect(isUrgent({ kind: 'no_deadline', tierIndex: 13 })).toBe(false);
    expect(isUrgent({ kind: 'far', daysRemaining: 400, extendedTierDays: 610 })).toBe(false);
  });
});
