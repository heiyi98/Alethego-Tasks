import type { OccurrenceStatus, RecurrenceOccurrence } from '../domain/occurrence';
import type { Task } from '../domain/task';
import type { CalendarDate } from '../schedule/calendar-date';
import { todayOf, type EvaluationContext } from '../time/zoned-time';
import { gregorian, type CalendarSystem } from './calendar';
import {
  WEEKDAYS,
  normalizePattern,
  parseRecurrenceRule,
  type MonthDay,
  type RecurrencePattern,
  type RecurrenceRuleSpec,
  type Weekday,
} from './recurrence-rule';

/**
 * 循环规则引擎：按日期（没有时刻、没有时区）推算各次的日期、选代表实例、判定归档。纯函数，不做读写。
 *
 * - 第一次：从开始日期起，第一个符合规则的日子。
 * - "每 N 个周期"从开始日期所在的周期数起（周以周一开始）。
 * - 一天过完（用户本地日期过了这一天）这一次才算过去。
 * - 推算某个周期里有哪些日子交给历法模块（calendar.ts），以后换历法只换那个模块。
 */

/** 循环序列：规则 + 开始日期 */
export interface RecurrenceSeries {
  /** RFC 5545 RRULE（一行或几行），见 recurrence-rule.ts */
  rule: string;
  start: CalendarDate;
}

/** 代表实例：循环任务此刻提供给清单、矩阵、今日的那一次 */
export interface RepresentativeInstance {
  occurrenceDate: CalendarDate;
}

export interface NewOccurrence {
  occurrenceDate: CalendarDate;
  status: Extract<OccurrenceStatus, 'pending' | 'missed'>;
}

export interface ReconcileResult {
  toCreate: NewOccurrence[];
  /** 需要改为 missed 的已有 pending 记录 id */
  toMarkMissed: string[];
}

/** 一直找不到符合规则的日子时，最多往后看这么多个周期 */
const MAX_EMPTY_PERIODS = 2000;
/** 向后查找代表实例时最多跳过的已完成实例数 */
const MAX_REPRESENTATIVE_SCAN = 1000;
/** 单次归档最多补建的实例记录数（长期未打开应用时，只补最近的这部分） */
export const MAX_BACKFILL_OCCURRENCES = 500;

export function seriesFromTask(
  task: Pick<Task, 'recurrenceRule' | 'recurrenceStartOn'>,
): RecurrenceSeries | null {
  if (!task.recurrenceRule || !task.recurrenceStartOn) return null;
  return { rule: task.recurrenceRule, start: task.recurrenceStartOn };
}

const weekdayIndex = (day: Weekday) => WEEKDAYS.indexOf(day);

function monthDays(
  calendar: CalendarSystem,
  year: number,
  month: number,
  days: readonly MonthDay[],
): CalendarDate[] {
  // 短月份：超过当月天数的日子落到当月最后一天（dateOf 负责）；和"最后一天"重合时只算一次
  return days.map((d) =>
    calendar.dateOf(year, month, d === 'last' ? calendar.daysInMonth(year, month) : d),
  );
}

function ordinalWeekdays(
  calendar: CalendarSystem,
  year: number,
  month: number,
  rows: readonly { ordinal: number; weekdays: readonly Weekday[] }[],
): CalendarDate[] {
  return rows.flatMap((row) =>
    row.weekdays
      .map((d) => calendar.nthWeekdayOfMonth(year, month, weekdayIndex(d), row.ordinal))
      .filter((d): d is CalendarDate => d !== null),
  );
}

/** 一个周期里符合规则的日子，从早到晚、不重复 */
function datesInPeriod(
  calendar: CalendarSystem,
  pattern: RecurrencePattern,
  index: number,
): CalendarDate[] {
  const first = calendar.periodStart(index, pattern.period);
  let dates: CalendarDate[];
  switch (pattern.period) {
    case 'day':
      dates = [first];
      break;
    case 'week': {
      const monday = calendar.periodStart(index, 'week');
      dates = pattern.weekdays.map((d) => {
        const offset = weekdayIndex(d);
        // 周一 + offset 天
        return calendar.periodStart(calendar.periodIndex(monday, 'day') + offset, 'day');
      });
      break;
    }
    case 'month': {
      const year = calendar.yearOf(first);
      const month = calendar.monthOf(first);
      dates =
        pattern.by === 'day'
          ? monthDays(calendar, year, month, pattern.days)
          : ordinalWeekdays(calendar, year, month, pattern.rows);
      break;
    }
    case 'year': {
      const year = index;
      if (pattern.by === 'monthDay') {
        dates = Object.entries(pattern.days).flatMap(([month, days]) =>
          monthDays(calendar, year, Number(month), days),
        );
      } else if (pattern.by === 'monthWeekday') {
        dates = pattern.rows.flatMap((row) => ordinalWeekdays(calendar, year, row.month, [row]));
      } else {
        // 年周：按 ISO 8601 周年；-1 = 这一年的最后一周
        dates = pattern.rows.flatMap((row) =>
          row.weekdays
            .map((d) => calendar.dateOfWeek(year, row.week, weekdayIndex(d)))
            .filter((d): d is CalendarDate => d !== null),
        );
      }
      break;
    }
  }
  return [...new Set(dates)].sort();
}

/** 开始日期所在的周期序号（年周规则按周年算） */
function startPeriod(calendar: CalendarSystem, pattern: RecurrencePattern, start: CalendarDate) {
  if (pattern.period === 'year' && pattern.by === 'weekNumber') return calendar.weekYearOf(start);
  return calendar.periodIndex(start, pattern.period);
}

/**
 * 从开始日期起依次给出每一次的日期，一直重复下去（没有结束条件）。
 * from：只要这一天及以后的（直接跳到附近的周期，不从头数）。
 */
export function* iterateOccurrences(
  spec: RecurrenceRuleSpec,
  start: CalendarDate,
  from: CalendarDate = start,
  calendar: CalendarSystem = gregorian,
): Generator<CalendarDate> {
  const pattern = normalizePattern(spec.pattern);
  const interval = Math.max(1, Math.floor(spec.interval));
  const p0 = startPeriod(calendar, pattern, start);
  let k = 0;
  if (from > start) {
    const target = startPeriod(calendar, pattern, from);
    k = Math.max(0, Math.floor((target - p0) / interval) - 1);
  }
  let empty = 0;
  for (; empty < MAX_EMPTY_PERIODS; k++) {
    const dates = datesInPeriod(calendar, pattern, p0 + k * interval).filter((d) => d >= start);
    if (dates.length === 0) {
      empty++;
      continue;
    }
    empty = 0;
    for (const date of dates) {
      if (date >= from) yield date;
    }
  }
}

function specOf(series: RecurrenceSeries): RecurrenceRuleSpec | null {
  return parseRecurrenceRule(series.rule);
}

/** [from, to] 区间内（含两端）的各次日期 */
export function occurrencesBetween(
  series: RecurrenceSeries,
  from: CalendarDate,
  to: CalendarDate,
): CalendarDate[] {
  const spec = specOf(series);
  if (!spec) return [];
  const result: CalendarDate[] = [];
  for (const date of iterateOccurrences(spec, series.start, from)) {
    if (date > to) break;
    result.push(date);
  }
  return result;
}

/** 某天及以后（inclusive = false 时为之后）的第一次；规则里一个日子都没有时为 null */
export function nextOccurrence(
  series: RecurrenceSeries,
  after: CalendarDate,
  inclusive = true,
): CalendarDate | null {
  const spec = specOf(series);
  if (!spec) return null;
  for (const date of iterateOccurrences(spec, series.start, after)) {
    if (inclusive || date > after) return date;
  }
  return null;
}

/**
 * 代表实例 = 最早一个还没完成、日期还没过去（不早于今天）的那一次。
 * 已完成的（包括提前完成的）被跳过。循环任务因此永远不会逾期。规则里一个日子都没有时为 null。
 */
export function resolveRepresentativeInstance(
  series: RecurrenceSeries,
  occurrences: readonly Pick<RecurrenceOccurrence, 'occurrenceDate' | 'status'>[],
  context: EvaluationContext,
): RepresentativeInstance | null {
  const spec = specOf(series);
  if (!spec) return null;
  const completed = new Set(
    occurrences.filter((o) => o.status === 'completed').map((o) => o.occurrenceDate),
  );
  let scanned = 0;
  for (const date of iterateOccurrences(spec, series.start, todayOf(context))) {
    if (!completed.has(date)) return { occurrenceDate: date };
    if (++scanned >= MAX_REPRESENTATIVE_SCAN) return null;
  }
  return null;
}

/**
 * 归档判定：日期已经过去（早于今天）还没勾选的那一次，记为未完成（missed）进入历史。
 * - 过去的日子都应有一条记录；缺的以 missed 补建。
 * - 已有的 pending 记录日期一过即改为 missed。
 * 只处理 pending → missed；completed 与用户改过的记录不动。
 *
 * 补建的起点：第一次从开始日期起补；之后只从已过去的已有记录里最晚的那一条往后补（改了规则时，
 * 已有记录不动，新规则只管以后的日子）。开始日期本身改了时，调用方传 backfillFrom = 新的开始日期。
 */
export function reconcileOccurrences(
  series: RecurrenceSeries,
  existing: readonly Pick<RecurrenceOccurrence, 'id' | 'occurrenceDate' | 'status'>[],
  context: EvaluationContext,
  options: { backfillFrom?: CalendarDate } = {},
): ReconcileResult {
  const today = todayOf(context);
  const passed = (date: CalendarDate) => date < today;

  // 提前完成的未来实例不能作为起点，否则会跳过它之前、已经过去的实例
  const scanFrom =
    options.backfillFrom ??
    existing.reduce<CalendarDate>(
      (latest, o) =>
        passed(o.occurrenceDate) && o.occurrenceDate > latest ? o.occurrenceDate : latest,
      series.start,
    );
  const existingKeys = new Set(existing.map((o) => o.occurrenceDate));

  const toCreate: NewOccurrence[] =
    scanFrom < today
      ? occurrencesBetween(series, scanFrom, today)
          .filter((date) => passed(date) && !existingKeys.has(date))
          .slice(-MAX_BACKFILL_OCCURRENCES)
          .map((occurrenceDate) => ({ occurrenceDate, status: 'missed' }))
      : [];

  const toMarkMissed = existing
    .filter((o) => o.status === 'pending' && passed(o.occurrenceDate))
    .map((o) => o.id);

  return { toCreate, toMarkMissed };
}
