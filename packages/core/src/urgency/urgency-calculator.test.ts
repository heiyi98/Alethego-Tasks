import { describe, expect, it } from 'vitest';

import {
  BASE_TIER_DAYS,
  EXTENDED_TIER_DAYS,
  LAST_URGENT_TIER_INDEX,
  MAX_TIER_INDEX,
} from './tiers';
import { calculateUrgency, isUrgent, tierIndexForDayNumber } from './urgency-calculator';

const timeZone = 'Asia/Shanghai';
/** 上海本地时间 → UTC 时间点 */
const sh = (local: string) => new Date(`${local}+08:00`);
// 2026-10-05 是周一
const context = { now: sh('2026-10-05T15:54:00'), timeZone };
const endOf = (date: string) => sh(`${date}T23:59:59.999`);

describe('标尺', () => {
  it('自然天数，不再是斐波那契数', () => {
    expect(BASE_TIER_DAYS).toEqual([1, 2, 3, 5, 7, 14, 21, 30, 60, 90, 180, 270, 365]);
    expect(EXTENDED_TIER_DAYS).toEqual([730, 1095, 1825, 2555, 3650]);
    expect(MAX_TIER_INDEX).toBe(12);
    expect(BASE_TIER_DAYS[LAST_URGENT_TIER_INDEX]).toBe(14);
  });
});

describe('tierIndexForDayNumber：N 的区间上界含在内', () => {
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
    [15, 6],
    [21, 6],
    [22, 7],
    [30, 7],
    [31, 8],
    [60, 8],
    [61, 9],
    [90, 9],
    [91, 10],
    [180, 10],
    [181, 11],
    [270, 11],
    [271, 12],
    [365, 12],
  ])('N = %i → 第 %i 档', (n, tier) => {
    expect(tierIndexForDayNumber(n)).toBe(tier);
  });

  it('N > 365 返回 null', () => {
    expect(tierIndexForDayNumber(366)).toBeNull();
  });
});

describe('calculateUrgency：按日历日判档，今天算第 1 天', () => {
  it('无截止时间 → 最大档', () => {
    expect(calculateUrgency(null, context)).toEqual({ kind: 'no_deadline', tierIndex: 12 });
  });

  it('只看截止日期，不看几点几分：日期型与设了时刻的落在同一档', () => {
    for (const deadline of [
      sh('2026-10-06T00:30:00'),
      sh('2026-10-06T09:00:00'),
      endOf('2026-10-06'),
    ]) {
      expect(calculateUrgency(deadline, context)).toMatchObject({
        kind: 'scheduled',
        dayNumber: 2,
        tierIndex: 1,
      });
    }
    for (const deadline of [sh('2026-10-05T16:00:00'), endOf('2026-10-05')]) {
      expect(calculateUrgency(deadline, context)).toMatchObject({ dayNumber: 1, tierIndex: 0 });
    }
  });

  it('深夜看凌晨截止的任务：跨过午夜就是 N = 2', () => {
    const lateNight = { now: sh('2026-10-05T23:30:00'), timeZone };
    expect(calculateUrgency(sh('2026-10-06T00:30:00'), lateNight)).toMatchObject({ dayNumber: 2 });
  });

  it('按用户时区的日历日', () => {
    const deadline = new Date('2026-10-05T20:00:00Z');
    const nowUtc = new Date('2026-10-05T10:00:00Z');
    expect(calculateUrgency(deadline, { now: nowUtc, timeZone: 'UTC' })).toMatchObject({
      dayNumber: 1,
    });
    expect(calculateUrgency(deadline, { now: nowUtc, timeZone })).toMatchObject({ dayNumber: 2 });
  });

  it('N > 365 → 扩展向量（两年、三年……十年）', () => {
    expect(calculateUrgency(endOf('2027-10-10'), context)).toMatchObject({
      kind: 'far',
      extendedTierDays: 730,
    });
    expect(calculateUrgency(endOf('2040-01-01'), context)).toMatchObject({
      kind: 'far',
      extendedTierDays: null,
    });
  });

  it('超过截止时刻即逾期：设了时刻的当天已过点 → 逾期 0 天', () => {
    expect(calculateUrgency(sh('2026-10-05T09:00:00'), context)).toEqual({
      kind: 'overdue',
      overdueDays: 0,
    });
  });

  it('日期型从截止日期的次日 00:00 起逾期：昨天截止 → 逾期 1 天', () => {
    expect(calculateUrgency(endOf('2026-10-04'), context)).toEqual({
      kind: 'overdue',
      overdueDays: 1,
    });
    expect(calculateUrgency(endOf('2026-10-03'), context)).toEqual({
      kind: 'overdue',
      overdueDays: 2,
    });
  });

  it('逾期天数不封顶', () => {
    expect(calculateUrgency(sh('2026-01-01T09:00:00'), context)).toEqual({
      kind: 'overdue',
      overdueDays: 277,
    });
  });
});

describe('isUrgent：以两周为界', () => {
  it('N ≤ 14 为紧急，N = 15 不紧急', () => {
    expect(isUrgent(calculateUrgency(endOf('2026-10-18'), context))).toBe(true); // N = 14
    expect(isUrgent(calculateUrgency(sh('2026-10-19T00:00:00'), context))).toBe(false); // N = 15
  });

  it('逾期为紧急，无截止时间与远期为不紧急', () => {
    expect(isUrgent({ kind: 'overdue', overdueDays: 2 })).toBe(true);
    expect(isUrgent({ kind: 'no_deadline', tierIndex: 12 })).toBe(false);
    expect(isUrgent({ kind: 'far', dayNumber: 400, extendedTierDays: 730 })).toBe(false);
  });
});
