import { endOfLocalDay, fromWallTime, toWallTime } from '../time/zoned-time';

/**
 * 日历日（没有时刻、没有时区）："YYYY-MM-DD"。任务关系、甘特图都以天为单位。
 */
export type CalendarDate = string;

const MS_PER_DAY = 86_400_000;
const PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCalendarDate(value: string): value is CalendarDate {
  return PATTERN.test(value);
}

/** 自 1970-01-01 起的天数 */
export function dayNumber(date: CalendarDate): number {
  const m = PATTERN.exec(date);
  if (!m) throw new Error(`不是日期：${date}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_PER_DAY;
}

export function fromDayNumber(n: number): CalendarDate {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  return fromDayNumber(dayNumber(date) + days);
}

/** b − a（天） */
export function daysBetween(a: CalendarDate, b: CalendarDate): number {
  return dayNumber(b) - dayNumber(a);
}

/** 最晚的日期；空列表为 null */
export function latestDate(dates: readonly (CalendarDate | null)[]): CalendarDate | null {
  let best: CalendarDate | null = null;
  for (const d of dates) if (d !== null && (best === null || d > best)) best = d;
  return best;
}

/** 时间点在某时区里所在的日期 */
export function dateOfInstant(instant: Date, timeZone: string): CalendarDate {
  return toWallTime(instant, timeZone).toISOString().slice(0, 10);
}

/** 某日期在某时区的最后一刻（"没选时刻 = 当天最后一刻"） */
export function endOfDate(date: CalendarDate, timeZone: string): Date {
  const start = fromWallTime(new Date(dayNumber(date) * MS_PER_DAY), timeZone);
  return endOfLocalDay(start, timeZone);
}
