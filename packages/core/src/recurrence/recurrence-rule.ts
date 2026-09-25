import { endOfLocalDay, toWallTime } from '../time/zoned-time';
import { isValidRecurrenceRule } from './recurrence-engine';

/**
 * 循环规则的结构化表示：UI 编辑的是这个对象，存储的是它生成的 RRULE 字符串（RFC 5545）。
 * 只覆盖界面上能编辑的子集；超出子集的规则（如"每月第一个周一"）parseRecurrenceRule 返回 null，
 * 由界面按"自定义规则"只读展示，规则本身仍可被 RecurrenceEngine 正常计算。
 */

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

/** RFC 5545 星期代码，周一在前 */
export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** 每月的"最后一天" */
export const LAST_DAY_OF_MONTH = -1;

export type RecurrenceEnd =
  | { kind: 'never' }
  | { kind: 'count'; count: number }
  /** 截止到这一时间点（含）；界面上选日期时取该日的本地日终点 */
  | { kind: 'until'; until: Date };

export interface RecurrenceRuleSpec {
  frequency: RecurrenceFrequency;
  /** 每隔几个周期，≥ 1 */
  interval: number;
  /** 仅 weekly：在哪几天，至少一天 */
  weekdays: Weekday[];
  /** 仅 monthly：每月几号，1–31 或 LAST_DAY_OF_MONTH，至少一个 */
  monthDays: number[];
  end: RecurrenceEnd;
}

const FREQ_CODES: Record<RecurrenceFrequency, string> = {
  daily: 'DAILY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
  yearly: 'YEARLY',
};

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function formatUntil(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function parseUntil(value: string): Date | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h = '23', mi = '59', s = '59'] = match;
  return new Date(Date.UTC(+y!, +mo! - 1, +d!, +h, +mi, +s));
}

function sortWeekdays(days: readonly Weekday[]): Weekday[] {
  return WEEKDAYS.filter((day) => days.includes(day));
}

function sortMonthDays(days: readonly number[]): number[] {
  // 具体日期升序，"最后一天"排在最后
  return [...new Set(days)].sort((a, b) => (a < 0 ? 99 : a) - (b < 0 ? 99 : b));
}

/** 结构 → RRULE 字符串（不含 "RRULE:" 前缀） */
export function buildRecurrenceRule(spec: RecurrenceRuleSpec): string {
  const parts = [`FREQ=${FREQ_CODES[spec.frequency]}`];
  if (spec.interval > 1) parts.push(`INTERVAL=${Math.floor(spec.interval)}`);
  if (spec.frequency === 'weekly' && spec.weekdays.length > 0) {
    parts.push(`BYDAY=${sortWeekdays(spec.weekdays).join(',')}`);
  }
  if (spec.frequency === 'monthly' && spec.monthDays.length > 0) {
    parts.push(`BYMONTHDAY=${sortMonthDays(spec.monthDays).join(',')}`);
  }
  if (spec.end.kind === 'count') parts.push(`COUNT=${Math.floor(spec.end.count)}`);
  if (spec.end.kind === 'until') parts.push(`UNTIL=${formatUntil(spec.end.until)}`);
  return parts.join(';');
}

/** RRULE 字符串 → 结构；超出可编辑子集时返回 null */
export function parseRecurrenceRule(rule: string): RecurrenceRuleSpec | null {
  const line = rule
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.toUpperCase().startsWith('DTSTART'));
  if (!line) return null;
  const body = line.replace(/^RRULE:/i, '');

  const fields = new Map<string, string>();
  for (const part of body.split(';')) {
    if (!part) continue;
    const [key, value] = part.split('=');
    if (!key || value === undefined) return null;
    fields.set(key.toUpperCase(), value.toUpperCase());
  }

  const frequency = (Object.keys(FREQ_CODES) as RecurrenceFrequency[]).find(
    (f) => FREQ_CODES[f] === fields.get('FREQ'),
  );
  if (!frequency) return null;

  const spec: RecurrenceRuleSpec = {
    frequency,
    interval: 1,
    weekdays: [],
    monthDays: [],
    end: { kind: 'never' },
  };

  for (const [key, value] of fields) {
    switch (key) {
      case 'FREQ':
      case 'WKST':
        break;
      case 'INTERVAL': {
        const interval = Number(value);
        if (!Number.isInteger(interval) || interval < 1) return null;
        spec.interval = interval;
        break;
      }
      case 'BYDAY': {
        if (frequency !== 'weekly') return null;
        const days = value.split(',');
        if (!days.every((d): d is Weekday => (WEEKDAYS as readonly string[]).includes(d))) {
          return null; // 带序号的写法（如 +1MO）不在可编辑范围
        }
        spec.weekdays = sortWeekdays(days);
        break;
      }
      case 'BYMONTHDAY': {
        if (frequency !== 'monthly') return null;
        const days = value.split(',').map(Number);
        if (!days.every((d) => Number.isInteger(d) && ((d >= 1 && d <= 31) || d === -1))) {
          return null;
        }
        spec.monthDays = sortMonthDays(days);
        break;
      }
      case 'COUNT': {
        const count = Number(value);
        if (!Number.isInteger(count) || count < 1 || spec.end.kind !== 'never') return null;
        spec.end = { kind: 'count', count };
        break;
      }
      case 'UNTIL': {
        const until = parseUntil(value);
        if (!until || spec.end.kind !== 'never') return null;
        spec.end = { kind: 'until', until };
        break;
      }
      default:
        return null;
    }
  }
  return spec;
}

/** 某时间点在用户时区是星期几 */
export function weekdayOf(date: Date, timeZone: string): Weekday {
  // getUTCDay：0 = 周日
  return WEEKDAYS[(toWallTime(date, timeZone).getUTCDay() + 6) % 7]!;
}

/** 某时间点在用户时区是几号 */
export function monthDayOf(date: Date, timeZone: string): number {
  return toWallTime(date, timeZone).getUTCDate();
}

/** 打开循环开关时的默认规则：每周，在起始时间所在的星期几 */
export function defaultRecurrenceSpec(dtstart: Date, timeZone: string): RecurrenceRuleSpec {
  return {
    frequency: 'weekly',
    interval: 1,
    weekdays: [weekdayOf(dtstart, timeZone)],
    monthDays: [monthDayOf(dtstart, timeZone)],
    end: { kind: 'never' },
  };
}

/** 截止日期（本地日期）→ UNTIL 时间点：该日的本地日终点 */
export function untilFromLocalDate(date: Date, timeZone: string): Date {
  return endOfLocalDay(date, timeZone);
}

export type RecurrenceSpecError = 'no_weekday' | 'no_month_day' | 'bad_interval' | 'bad_count';

/** 保存前的校验；返回 null 表示合法 */
export function validateRecurrenceSpec(spec: RecurrenceRuleSpec): RecurrenceSpecError | null {
  if (!Number.isInteger(spec.interval) || spec.interval < 1) return 'bad_interval';
  if (spec.frequency === 'weekly' && spec.weekdays.length === 0) return 'no_weekday';
  if (spec.frequency === 'monthly' && spec.monthDays.length === 0) return 'no_month_day';
  if (spec.end.kind === 'count' && (!Number.isInteger(spec.end.count) || spec.end.count < 1)) {
    return 'bad_count';
  }
  if (!isValidRecurrenceRule(buildRecurrenceRule(spec))) return 'bad_interval';
  return null;
}

const WEEKDAY_NAMES: Record<Weekday, string> = {
  MO: '一',
  TU: '二',
  WE: '三',
  TH: '四',
  FR: '五',
  SA: '六',
  SU: '日',
};

export function weekdayName(day: Weekday): string {
  return WEEKDAY_NAMES[day];
}

const UNIT: Record<RecurrenceFrequency, string> = {
  daily: '天',
  weekly: '周',
  monthly: '个月',
  yearly: '年',
};

/** 中文描述，如"每周一、三、五"、"每 2 个月的 1 号和最后一天，共 10 次" */
export function describeRecurrence(spec: RecurrenceRuleSpec, timeZone: string): string {
  const every =
    spec.interval === 1
      ? { daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年' }[spec.frequency]
      : `每 ${spec.interval} ${UNIT[spec.frequency]}`;

  let text = every;
  if (spec.frequency === 'weekly' && spec.weekdays.length > 0) {
    const days = sortWeekdays(spec.weekdays).map(weekdayName).join('、');
    text = spec.interval === 1 ? `每周${days}` : `${every}的周${days}`;
  }
  if (spec.frequency === 'monthly' && spec.monthDays.length > 0) {
    const days = sortMonthDays(spec.monthDays);
    const numbers = days.filter((d) => d > 0);
    const parts = [
      ...(numbers.length > 0 ? [`${numbers.join('、')}号`] : []),
      ...(days.includes(LAST_DAY_OF_MONTH) ? ['最后一天'] : []),
    ];
    text = `${every}${spec.interval === 1 ? '' : '的'}${parts.join('和')}`;
  }

  if (spec.end.kind === 'count') text += `，共 ${spec.end.count} 次`;
  if (spec.end.kind === 'until') {
    const wall = toWallTime(spec.end.until, timeZone);
    text += `，到 ${wall.getUTCFullYear()}年${wall.getUTCMonth() + 1}月${wall.getUTCDate()}日为止`;
  }
  return text;
}
