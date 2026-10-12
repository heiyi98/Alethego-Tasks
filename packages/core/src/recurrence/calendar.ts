import { dayNumber, fromDayNumber, type CalendarDate } from '../schedule/calendar-date';

/**
 * 历法模块：循环规则只说"周期（日、周、月、年）+ 周期里的位置"，具体某个周期里有哪些日子由历法决定。
 * 以后加入其他历法时，换一个实现这个接口的模块即可（模式的名字也可以跟着历法改），规则结构和引擎不动。
 * 现在只有公历（ISO 8601 周：每周从周一开始，包含当年第一个星期四的那一周是第 1 周）。
 *
 * 星期一律用 0–6 表示，0 = 周一。
 */
export interface CalendarSystem {
  /** 历法的标识，写进 RRULE 的 RSCALE */
  id: 'gregorian';
  /** 某天在一个周期序列里的序号（同一周期的日子序号相同，相邻周期差 1） */
  periodIndex(date: CalendarDate, period: 'day' | 'week' | 'month' | 'year'): number;
  /** 周期序号 → 周期的第一天 */
  periodStart(index: number, period: 'day' | 'week' | 'month' | 'year'): CalendarDate;
  /** 年、月（1 起）、日 → 日期；日超过当月天数时落到当月最后一天 */
  dateOf(year: number, month: number, day: number): CalendarDate;
  yearOf(date: CalendarDate): number;
  monthOf(date: CalendarDate): number;
  dayOf(date: CalendarDate): number;
  monthsInYear(year: number): number;
  daysInMonth(year: number, month: number): number;
  /** 0 = 周一 … 6 = 周日 */
  weekdayOf(date: CalendarDate): number;
  /** 某月第 n 个星期几（n = -1 为最后一个）；没有时为 null */
  nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): CalendarDate | null;
  /** 按周编号的年（ISO 8601 周年）：weekYear 年第 week 周的星期几；这一年没有这一周时为 null */
  dateOfWeek(weekYear: number, week: number, weekday: number): CalendarDate | null;
  /** 某天所在的周年 */
  weekYearOf(date: CalendarDate): number;
  /** 某天是它所在周年的第几周 */
  weekOf(date: CalendarDate): number;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** 1970-01-05 是第一个周一（自 1970-01-01 起的第 4 天） */
const FIRST_MONDAY = 4;

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function daysInMonth(year: number, month: number): number {
  return month === 2 && isLeap(year) ? 29 : DAYS[month - 1]!;
}

function parts(date: CalendarDate): [number, number, number] {
  return [Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))];
}

function make(year: number, month: number, day: number): CalendarDate {
  return `${pad(year, 4)}-${pad(month)}-${pad(Math.min(day, daysInMonth(year, month)))}`;
}

/** 1970-01-01 是周四（0 = 周一时为 3） */
function weekday(date: CalendarDate): number {
  return (((dayNumber(date) + 3) % 7) + 7) % 7;
}

/** ISO 周年第 1 周的周一：包含 1 月 4 日（也就是当年第一个星期四）的那一周 */
function firstMondayOfWeekYear(weekYear: number): number {
  const jan4 = dayNumber(make(weekYear, 1, 4));
  return jan4 - weekday(make(weekYear, 1, 4));
}

function weekYearOf(date: CalendarDate): number {
  const year = Number(date.slice(0, 4));
  const n = dayNumber(date);
  if (n >= firstMondayOfWeekYear(year + 1)) return year + 1;
  if (n < firstMondayOfWeekYear(year)) return year - 1;
  return year;
}

export const gregorian: CalendarSystem = {
  id: 'gregorian',

  periodIndex(date, period) {
    const [y, m] = parts(date);
    switch (period) {
      case 'day':
        return dayNumber(date);
      case 'week':
        // 以周一为一周的开始；1970-01-05（序号 4）是周一
        return Math.floor((dayNumber(date) - FIRST_MONDAY) / 7);
      case 'month':
        return y * 12 + (m - 1);
      case 'year':
        return y;
    }
  },

  periodStart(index, period) {
    switch (period) {
      case 'day':
        return fromDayNumber(index);
      case 'week':
        return fromDayNumber(index * 7 + FIRST_MONDAY);
      case 'month':
        return make(Math.floor(index / 12), (index % 12) + 1, 1);
      case 'year':
        return make(index, 1, 1);
    }
  },

  dateOf: make,
  yearOf: (date) => parts(date)[0],
  monthOf: (date) => parts(date)[1],
  dayOf: (date) => parts(date)[2],
  monthsInYear: () => 12,
  daysInMonth,
  weekdayOf: weekday,

  nthWeekdayOfMonth(year, month, wd, n) {
    const dim = daysInMonth(year, month);
    if (n === -1) {
      const last = make(year, month, dim);
      const back = (weekday(last) - wd + 7) % 7;
      return make(year, month, dim - back);
    }
    const first = make(year, month, 1);
    const day = 1 + ((wd - weekday(first) + 7) % 7) + (n - 1) * 7;
    return day <= dim ? make(year, month, day) : null;
  },

  dateOfWeek(weekYear, week, wd) {
    const monday = firstMondayOfWeekYear(weekYear);
    const weeks = (firstMondayOfWeekYear(weekYear + 1) - monday) / 7;
    if (week < 1 || week > weeks) return null;
    return fromDayNumber(monday + (week - 1) * 7 + wd);
  },

  weekYearOf,

  weekOf(date) {
    return Math.floor((dayNumber(date) - firstMondayOfWeekYear(weekYearOf(date))) / 7) + 1;
  },
};
