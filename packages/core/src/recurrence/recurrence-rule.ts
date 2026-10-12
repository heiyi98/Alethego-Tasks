import type { CalendarDate } from '../schedule/calendar-date';

/**
 * 循环规则的结构：周期（日、周、月、年）+ 间隔 + 周期里的位置 + 结束条件。和历法无关：
 * "某月""第几周"是什么日子由历法模块（calendar.ts）决定。
 *
 * 存储用 RFC 5545 的 RRULE（见 buildRecurrenceRule / parseRecurrenceRule）：
 * - 同一个月 / 年里只能用一种标尺（月：日 / 周；年：月日 / 月周 / 年周）。
 * - 年里任意的"某月某日""某月第几个星期几"组合，一条 RRULE 表达不了（BYMONTH 和 BYMONTHDAY 是交叉组合），
 *   就写成几条 RRULE（每行一条），取并集。
 * - 选了 29、30、31 日时，没有这一天的月份落到当月最后一天：用 RFC 7529 的 RSCALE=GREGORIAN;SKIP=BACKWARD。
 */

export type RecurrencePeriod = 'day' | 'week' | 'month' | 'year';
export const RECURRENCE_PERIODS: readonly RecurrencePeriod[] = ['day', 'week', 'month', 'year'];

/** RFC 5545 星期代码，周一在前（下标 0 = 周一，和历法模块一致） */
export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** 第几个：1–4，-1 = 最后一个 */
export type Ordinal = 1 | 2 | 3 | 4 | -1;
export const ORDINALS: readonly Ordinal[] = [1, 2, 3, 4, -1];

/** 月里的日子：1–31，或者"最后一天" */
export type MonthDay = number | 'last';

export interface OrdinalWeekdays {
  ordinal: Ordinal;
  weekdays: Weekday[];
}
export interface MonthOrdinalWeekdays extends OrdinalWeekdays {
  month: number;
}
export interface WeekNumberWeekdays {
  week: number;
  weekdays: Weekday[];
}

/** 周期里的位置 */
export type RecurrencePattern =
  | { period: 'day' }
  | { period: 'week'; weekdays: Weekday[] }
  | { period: 'month'; by: 'day'; days: MonthDay[] }
  | { period: 'month'; by: 'weekday'; rows: OrdinalWeekdays[] }
  /** 月日：days[月份 1–12] = 这个月的哪几天 */
  | { period: 'year'; by: 'monthDay'; days: Record<number, number[]> }
  | { period: 'year'; by: 'monthWeekday'; rows: MonthOrdinalWeekdays[] }
  /** 年周：ISO 8601 周数 */
  | { period: 'year'; by: 'weekNumber'; rows: WeekNumberWeekdays[] };

export type RecurrenceEnd =
  | { kind: 'never' }
  | { kind: 'count'; count: number }
  /** 到这一天为止（含） */
  | { kind: 'until'; until: CalendarDate };

export interface RecurrenceRuleSpec {
  pattern: RecurrencePattern;
  /** 每隔几个周期，≥ 1 */
  interval: number;
  end: RecurrenceEnd;
}

const sortWeekdays = (days: readonly Weekday[]): Weekday[] =>
  WEEKDAYS.filter((day) => days.includes(day));

const ordinalRank = (o: Ordinal) => (o === -1 ? 5 : o);

const sortMonthDays = (days: readonly MonthDay[]): MonthDay[] => {
  const numbers = [...new Set(days.filter((d): d is number => d !== 'last'))].sort((a, b) => a - b);
  return days.includes('last') ? [...numbers, 'last'] : numbers;
};

/** 把行里相同的条件合并、排好序（保存后读回来是这个样子） */
export function normalizePattern(pattern: RecurrencePattern): RecurrencePattern {
  switch (pattern.period) {
    case 'day':
      return pattern;
    case 'week':
      return { period: 'week', weekdays: sortWeekdays(pattern.weekdays) };
    case 'month':
      if (pattern.by === 'day') return { ...pattern, days: sortMonthDays(pattern.days) };
      return { ...pattern, rows: mergeOrdinalRows(pattern.rows) };
    case 'year': {
      if (pattern.by === 'monthDay') {
        const days: Record<number, number[]> = {};
        for (const [month, list] of Object.entries(pattern.days)) {
          const sorted = [...new Set(list)].sort((a, b) => a - b);
          if (sorted.length > 0) days[Number(month)] = sorted;
        }
        return { ...pattern, days };
      }
      if (pattern.by === 'monthWeekday') {
        const byMonth = new Map<number, OrdinalWeekdays[]>();
        for (const row of pattern.rows) {
          byMonth.set(row.month, [...(byMonth.get(row.month) ?? []), row]);
        }
        const rows = [...byMonth.keys()]
          .sort((a, b) => a - b)
          .flatMap((month) =>
            mergeOrdinalRows(byMonth.get(month)!).map((row) => ({ month, ...row })),
          );
        return { ...pattern, rows };
      }
      const byWeek = new Map<number, Set<Weekday>>();
      for (const row of pattern.rows) {
        const set = byWeek.get(row.week) ?? new Set<Weekday>();
        row.weekdays.forEach((d) => set.add(d));
        byWeek.set(row.week, set);
      }
      const rows = [...byWeek.entries()]
        .filter(([, set]) => set.size > 0)
        .sort(([a], [b]) => a - b)
        .map(([week, set]) => ({ week, weekdays: sortWeekdays([...set]) }));
      return { ...pattern, rows };
    }
  }
}

function mergeOrdinalRows(rows: readonly OrdinalWeekdays[]): OrdinalWeekdays[] {
  const byOrdinal = new Map<Ordinal, Set<Weekday>>();
  for (const row of rows) {
    const set = byOrdinal.get(row.ordinal) ?? new Set<Weekday>();
    row.weekdays.forEach((d) => set.add(d));
    byOrdinal.set(row.ordinal, set);
  }
  return [...byOrdinal.entries()]
    .filter(([, set]) => set.size > 0)
    .sort(([a], [b]) => ordinalRank(a) - ordinalRank(b))
    .map(([ordinal, set]) => ({ ordinal, weekdays: sortWeekdays([...set]) }));
}

/* ------------------------------ RRULE ------------------------------ */

const FREQ: Record<RecurrencePeriod, string> = {
  day: 'DAILY',
  week: 'WEEKLY',
  month: 'MONTHLY',
  year: 'YEARLY',
};

const formatUntil = (date: CalendarDate) => date.replaceAll('-', '');

/** 选了 29、30、31 日：没有这一天的月份落到当月最后一天 */
const needsSkipBackward = (days: readonly MonthDay[]) =>
  days.some((d) => typeof d === 'number' && d >= 29);

const ordinalCode = (ordinal: Ordinal, day: Weekday) => `${ordinal}${day}`;

/** 结构 → RRULE。只有一条时不带 "RRULE:" 前缀；多条时每行一条，都带前缀 */
export function buildRecurrenceRule(spec: RecurrenceRuleSpec): string {
  const pattern = normalizePattern(spec.pattern);
  const common = (period: RecurrencePeriod, skip = false) => {
    const head = skip
      ? ['RSCALE=GREGORIAN', `FREQ=${FREQ[period]}`, 'SKIP=BACKWARD']
      : [`FREQ=${FREQ[period]}`];
    if (spec.interval > 1) head.push(`INTERVAL=${Math.floor(spec.interval)}`);
    return head;
  };
  const tail: string[] = [];
  if (spec.end.kind === 'count') tail.push(`COUNT=${Math.floor(spec.end.count)}`);
  if (spec.end.kind === 'until') tail.push(`UNTIL=${formatUntil(spec.end.until)}`);
  const line = (parts: string[]) => [...parts, ...tail].join(';');

  const lines: string[] = [];
  switch (pattern.period) {
    case 'day':
      lines.push(line(common('day')));
      break;
    case 'week':
      lines.push(line([...common('week'), 'WKST=MO', `BYDAY=${pattern.weekdays.join(',')}`]));
      break;
    case 'month':
      if (pattern.by === 'day') {
        const days = pattern.days.map((d) => (d === 'last' ? '-1' : String(d)));
        lines.push(
          line([
            ...common('month', needsSkipBackward(pattern.days)),
            `BYMONTHDAY=${days.join(',')}`,
          ]),
        );
      } else {
        const codes = pattern.rows.flatMap((r) => r.weekdays.map((d) => ordinalCode(r.ordinal, d)));
        lines.push(line([...common('month'), `BYDAY=${codes.join(',')}`]));
      }
      break;
    case 'year':
      if (pattern.by === 'monthDay') {
        // 日子相同的月份合成一条
        const groups = new Map<string, number[]>();
        for (const [month, days] of Object.entries(pattern.days)) {
          const key = days.join(',');
          groups.set(key, [...(groups.get(key) ?? []), Number(month)]);
        }
        for (const [key, months] of groups) {
          const days = key.split(',').map(Number);
          lines.push(
            line([
              ...common('year', needsSkipBackward(days)),
              `BYMONTH=${months.sort((a, b) => a - b).join(',')}`,
              `BYMONTHDAY=${key}`,
            ]),
          );
        }
      } else if (pattern.by === 'monthWeekday') {
        // 同一个月的条件合成一条；条件完全相同的月份再合成一条
        const byMonth = new Map<number, string[]>();
        for (const row of pattern.rows) {
          const codes = row.weekdays.map((d) => ordinalCode(row.ordinal, d));
          byMonth.set(row.month, [...(byMonth.get(row.month) ?? []), ...codes]);
        }
        const groups = new Map<string, number[]>();
        for (const [month, codes] of byMonth) {
          const key = codes.join(',');
          groups.set(key, [...(groups.get(key) ?? []), month]);
        }
        for (const [key, months] of groups) {
          lines.push(line([...common('year'), `BYMONTH=${months.join(',')}`, `BYDAY=${key}`]));
        }
      } else {
        // 星期相同的周合成一条
        const groups = new Map<string, number[]>();
        for (const row of pattern.rows) {
          const key = row.weekdays.join(',');
          groups.set(key, [...(groups.get(key) ?? []), row.week]);
        }
        for (const [key, weeks] of groups) {
          lines.push(
            line([...common('year'), 'WKST=MO', `BYWEEKNO=${weeks.join(',')}`, `BYDAY=${key}`]),
          );
        }
      }
      break;
  }
  return lines.length === 1 ? lines[0]! : lines.map((l) => `RRULE:${l}`).join('\n');
}

interface ParsedLine {
  period: RecurrencePeriod;
  interval: number;
  end: RecurrenceEnd;
  byDay: string[];
  byMonthDay: number[];
  byMonth: number[];
  byWeekNo: number[];
}

function parseLine(text: string): ParsedLine | null {
  const fields = new Map<string, string>();
  for (const part of text.replace(/^RRULE:/i, '').split(';')) {
    if (!part) continue;
    const [key, value] = part.split('=');
    if (!key || value === undefined || fields.has(key.toUpperCase())) return null;
    fields.set(key.toUpperCase(), value.toUpperCase());
  }
  const period = RECURRENCE_PERIODS.find((p) => FREQ[p] === fields.get('FREQ'));
  if (!period) return null;
  const list = (key: string) => (fields.get(key) ? fields.get(key)!.split(',') : []);
  const ints = (key: string) => list(key).map(Number);

  const parsed: ParsedLine = {
    period,
    interval: 1,
    end: { kind: 'never' },
    byDay: list('BYDAY'),
    byMonthDay: ints('BYMONTHDAY'),
    byMonth: ints('BYMONTH'),
    byWeekNo: ints('BYWEEKNO'),
  };
  for (const [key, value] of fields) {
    switch (key) {
      case 'FREQ':
      case 'BYDAY':
      case 'BYMONTHDAY':
      case 'BYMONTH':
      case 'BYWEEKNO':
        break;
      case 'WKST':
        if (value !== 'MO') return null;
        break;
      case 'RSCALE':
        if (value !== 'GREGORIAN') return null;
        break;
      case 'SKIP':
        if (value !== 'BACKWARD') return null;
        break;
      case 'INTERVAL': {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1) return null;
        parsed.interval = n;
        break;
      }
      case 'COUNT': {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1 || parsed.end.kind !== 'never') return null;
        parsed.end = { kind: 'count', count: n };
        break;
      }
      case 'UNTIL': {
        const m = /^(\d{4})(\d{2})(\d{2})(T\d{6}Z?)?$/.exec(value);
        if (!m || parsed.end.kind !== 'never') return null;
        parsed.end = { kind: 'until', until: `${m[1]}-${m[2]}-${m[3]}` };
        break;
      }
      default:
        return null;
    }
  }
  const allInts = [...parsed.byMonthDay, ...parsed.byMonth, ...parsed.byWeekNo];
  if (allInts.some((n) => !Number.isInteger(n))) return null;
  return parsed;
}

const plainWeekday = (code: string): Weekday | null =>
  (WEEKDAYS as readonly string[]).includes(code) ? (code as Weekday) : null;

function ordinalWeekday(code: string): { ordinal: Ordinal; weekday: Weekday } | null {
  const m = /^([+-]?\d)(MO|TU|WE|TH|FR|SA|SU)$/.exec(code);
  if (!m) return null;
  const ordinal = Number(m[1]);
  if (!(ORDINALS as readonly number[]).includes(ordinal)) return null;
  return { ordinal: ordinal as Ordinal, weekday: m[2] as Weekday };
}

function rowsFromCodes(codes: readonly string[]): OrdinalWeekdays[] | null {
  const rows: OrdinalWeekdays[] = [];
  for (const code of codes) {
    const parsed = ordinalWeekday(code);
    if (!parsed) return null;
    rows.push({ ordinal: parsed.ordinal, weekdays: [parsed.weekday] });
  }
  return mergeOrdinalRows(rows);
}

const validDay = (d: number) => d >= 1 && d <= 31;
const validMonth = (m: number) => m >= 1 && m <= 12;

/** RRULE（一行或几行）→ 结构；不是本应用能编辑的规则时返回 null */
export function parseRecurrenceRule(rule: string): RecurrenceRuleSpec | null {
  const texts = rule
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.toUpperCase().startsWith('DTSTART'));
  if (texts.length === 0) return null;
  const lines = texts.map(parseLine);
  if (lines.some((l) => l === null)) return null;
  const parsed = lines as ParsedLine[];
  const first = parsed[0]!;
  // 各行的周期、间隔、结束必须一致
  if (
    parsed.some(
      (l) =>
        l.period !== first.period ||
        l.interval !== first.interval ||
        JSON.stringify(l.end) !== JSON.stringify(first.end),
    )
  ) {
    return null;
  }
  const base = { interval: first.interval, end: first.end };

  if (first.period === 'day' || first.period === 'week' || first.period === 'month') {
    if (parsed.length !== 1 || first.byMonth.length > 0 || first.byWeekNo.length > 0) return null;
  }
  switch (first.period) {
    case 'day':
      if (first.byDay.length > 0 || first.byMonthDay.length > 0) return null;
      return { ...base, pattern: { period: 'day' } };
    case 'week': {
      const days = first.byDay.map(plainWeekday);
      if (first.byMonthDay.length > 0 || days.length === 0 || days.some((d) => d === null)) {
        return null;
      }
      return {
        ...base,
        pattern: normalizePattern({ period: 'week', weekdays: days as Weekday[] }),
      };
    }
    case 'month': {
      if (first.byMonthDay.length > 0) {
        if (first.byDay.length > 0) return null;
        if (first.byMonthDay.some((d) => d !== -1 && !validDay(d))) return null;
        const days = first.byMonthDay.map((d) => (d === -1 ? 'last' : d)) as MonthDay[];
        return { ...base, pattern: normalizePattern({ period: 'month', by: 'day', days }) };
      }
      const rows = rowsFromCodes(first.byDay);
      if (!rows || rows.length === 0) return null;
      return { ...base, pattern: { period: 'month', by: 'weekday', rows } };
    }
    case 'year': {
      if (parsed.every((l) => l.byWeekNo.length > 0)) {
        const rows: WeekNumberWeekdays[] = [];
        for (const l of parsed) {
          const days = l.byDay.map(plainWeekday);
          if (l.byMonth.length > 0 || l.byMonthDay.length > 0) return null;
          if (days.length === 0 || days.some((d) => d === null)) return null;
          if (l.byWeekNo.some((w) => w < 1 || w > 53)) return null;
          for (const week of l.byWeekNo) rows.push({ week, weekdays: days as Weekday[] });
        }
        return { ...base, pattern: normalizePattern({ period: 'year', by: 'weekNumber', rows }) };
      }
      if (parsed.some((l) => l.byWeekNo.length > 0 || l.byMonth.length === 0)) return null;
      if (parsed.some((l) => !l.byMonth.every(validMonth))) return null;
      if (parsed.every((l) => l.byMonthDay.length > 0 && l.byDay.length === 0)) {
        const days: Record<number, number[]> = {};
        for (const l of parsed) {
          if (!l.byMonthDay.every(validDay)) return null;
          for (const month of l.byMonth) days[month] = [...(days[month] ?? []), ...l.byMonthDay];
        }
        return { ...base, pattern: normalizePattern({ period: 'year', by: 'monthDay', days }) };
      }
      if (parsed.every((l) => l.byDay.length > 0 && l.byMonthDay.length === 0)) {
        const rows: MonthOrdinalWeekdays[] = [];
        for (const l of parsed) {
          const ordinalRows = rowsFromCodes(l.byDay);
          if (!ordinalRows) return null;
          for (const month of l.byMonth) {
            for (const row of ordinalRows) rows.push({ month, ...row });
          }
        }
        return { ...base, pattern: normalizePattern({ period: 'year', by: 'monthWeekday', rows }) };
      }
      return null;
    }
  }
}

export function isValidRecurrenceRule(rule: string): boolean {
  return parseRecurrenceRule(rule) !== null;
}

export type RecurrenceSpecError =
  'bad_interval' | 'bad_count' | 'no_weekday' | 'no_day' | 'no_condition';

/** 保存前的校验；返回 null 表示合法 */
export function validateRecurrenceSpec(spec: RecurrenceRuleSpec): RecurrenceSpecError | null {
  if (!Number.isInteger(spec.interval) || spec.interval < 1 || spec.interval > 999) {
    return 'bad_interval';
  }
  if (spec.end.kind === 'count' && (!Number.isInteger(spec.end.count) || spec.end.count < 1)) {
    return 'bad_count';
  }
  const pattern = normalizePattern(spec.pattern);
  switch (pattern.period) {
    case 'day':
      return null;
    case 'week':
      return pattern.weekdays.length === 0 ? 'no_weekday' : null;
    case 'month':
      if (pattern.by === 'day') return pattern.days.length === 0 ? 'no_day' : null;
      return pattern.rows.length === 0 ? 'no_condition' : null;
    case 'year':
      if (pattern.by === 'monthDay')
        return Object.keys(pattern.days).length === 0 ? 'no_day' : null;
      return pattern.rows.length === 0 ? 'no_condition' : null;
  }
}

/** 某个日期是星期几的代码 */
export function weekdayCode(index: number): Weekday {
  return WEEKDAYS[((index % 7) + 7) % 7]!;
}
