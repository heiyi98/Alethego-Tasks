import { describe, expect, it } from 'vitest';

import {
  calendarDaysBetween,
  endOfLocalDay,
  fromWallTime,
  startOfLocalDay,
  toWallTime,
} from './zoned-time';

describe('zoned-time', () => {
  it('墙上时间与时间点互相转换', () => {
    const instant = new Date('2026-09-25T02:30:00Z');
    const wall = toWallTime(instant, 'Asia/Shanghai');
    expect(wall.toISOString()).toBe('2026-09-25T10:30:00.000Z');
    expect(fromWallTime(wall, 'Asia/Shanghai')).toEqual(instant);
  });

  it('本地日的起止', () => {
    const instant = new Date('2026-09-25T02:30:00Z');
    expect(startOfLocalDay(instant, 'Asia/Shanghai')).toEqual(new Date('2026-09-24T16:00:00Z'));
    expect(endOfLocalDay(instant, 'Asia/Shanghai')).toEqual(new Date('2026-09-25T15:59:59.999Z'));
  });

  it('夏令时结束当天有 25 小时', () => {
    const instant = new Date('2026-11-01T12:00:00Z');
    const start = startOfLocalDay(instant, 'America/New_York');
    const end = endOfLocalDay(instant, 'America/New_York');
    expect(start).toEqual(new Date('2026-11-01T04:00:00Z'));
    expect(end.getTime() - start.getTime() + 1).toBe(25 * 3_600_000);
  });

  it('日历日差按时区计算', () => {
    const a = new Date('2026-09-25T15:00:00Z'); // 上海 23:00
    const b = new Date('2026-09-25T17:00:00Z'); // 上海次日 01:00
    expect(calendarDaysBetween(a, b, 'Asia/Shanghai')).toBe(1);
    expect(calendarDaysBetween(a, b, 'UTC')).toBe(0);
  });
});
