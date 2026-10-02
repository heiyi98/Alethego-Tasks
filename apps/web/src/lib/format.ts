import {
  DEFAULT_STATUS_FILTER,
  LIST_SCOPES,
  STATUS_FILTERS,
  calendarDaysBetween,
  endOfLocalDay,
  describeRecurrence,
  parseRecurrenceRule,
  weekdayName,
  weekdayOf,
  type ContainerFeatures,
  type ImportanceLevel,
  type ListScope,
  type Quadrant,
  type StatusFilter,
} from '@alethego/core';

export const SCOPE_LABELS: Record<ListScope, string> = {
  all: '总览',
  starred: '收藏',
};

/** 左侧菜单上区的显示顺序 */
export const SCOPE_ORDER: readonly ListScope[] = LIST_SCOPES;

export const STATUS_LABELS: Record<StatusFilter, string> = {
  all: '全部',
  todo: '未完成',
  completed: '已完成',
  missed: '已错过',
  pending: '待确认',
};

/** 所有状态（解析地址用） */
export const ALL_STATUSES: readonly StatusFilter[] = STATUS_FILTERS;

/** 页面内状态行的显示顺序；"待确认"只在需要 A 确认的容器（管理组）里出现，排在未完成和已完成之间 */
export const STATUS_ORDER: readonly StatusFilter[] = ['all', 'todo', 'completed', 'missed'];

const CONFIRMATION_STATUS_ORDER: readonly StatusFilter[] = [
  'all',
  'todo',
  'pending',
  'completed',
  'missed',
];

export function statusOrderFor(
  features: Pick<ContainerFeatures, 'confirmation'>,
): readonly StatusFilter[] {
  return features.confirmation ? CONFIRMATION_STATUS_ORDER : STATUS_ORDER;
}

/** 默认状态：未完成 */
export const DEFAULT_STATUS: StatusFilter = DEFAULT_STATUS_FILTER;

export const QUADRANT_LABELS: Record<Quadrant, string> = {
  important_urgent: '重要且紧急',
  important_not_urgent: '重要不紧急',
  not_important_urgent: '紧急不重要',
  not_important_not_urgent: '不重要不紧急',
};

/**
 * 矩阵 X 轴刻度名，标在分界线上（不标在格子中央）。
 * 键是分界的天数（MODE_TIER_DAYS 的取值），即各格的左边界；逾期区不标字。
 */
export const TIER_BOUNDARY_LABELS: Record<number, string> = {
  1: '1天',
  2: '2天',
  3: '3天',
  5: '5天',
  7: '一周',
  14: '两周',
  30: '一个月',
  90: '一季度',
  180: '半年',
};

export const IMPORTANCE_LEVELS: readonly ImportanceLevel[] = [0, 1, 2, 3, 4, 5];

export function importanceLabel(level: ImportanceLevel): string {
  return level === 0 ? '未设置' : String(level);
}

/** 浏览器所在时区 */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 只精确到天的截止时间存为当天本地日终点（23:59:59.999） */
export function isDateOnlyDeadline(deadline: Date, timeZone: string): boolean {
  return endOfLocalDay(deadline, timeZone).getTime() === deadline.getTime();
}

const dayLabel = (date: Date, now: Date, timeZone: string) => {
  const year = date.getFullYear() === now.getFullYear() ? '' : `${date.getFullYear()}年`;
  return `${year}${date.getMonth() + 1}月${date.getDate()}日 周${weekdayName(weekdayOf(date, timeZone))}`;
};

/**
 * 列表中的截止时间：日期 + 星期（+ 时刻）· 剩余天数。天数按日历天计算，不受时分影响。
 * - 今天：「今天」（选了时刻时带时刻，时刻已过则为「今天 09:00 · 已过」）
 * - 以后：「9月30日 周三 · 还剩2天」
 * - 已过期：「9月26日 周六 · 逾期2天」
 */
export function formatDeadline(deadline: Date, now: Date, timeZone: string): string {
  const time = isDateOnlyDeadline(deadline, timeZone)
    ? ''
    : ` ${pad(deadline.getHours())}:${pad(deadline.getMinutes())}`;
  const days = calendarDaysBetween(now, deadline, timeZone);
  if (days === 0) {
    return deadline.getTime() < now.getTime() ? `今天${time} · 已过` : `今天${time}`;
  }
  const label = `${dayLabel(deadline, now, timeZone)}${time}`;
  return days > 0 ? `${label} · 还剩${days}天` : `${label} · 逾期${-days}天`;
}

/** Date → <input type="time"> 的值（本地时刻）；只精确到天的截止时间为空字符串 */
export function toTimeValue(date: Date, timeZone: string): string {
  return isDateOnlyDeadline(date, timeZone)
    ? ''
    : `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Date → <input type="datetime-local"> 的值（本地时间） */
export function toDateTimeLocalValue(date: Date | null): string {
  if (!date) return '';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** <input type="datetime-local"> 的值 → Date；空字符串为 null */
export function fromDateTimeLocalValue(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 循环规则的简短描述；超出可编辑子集的规则显示为"自定义重复" */
export function recurrenceLabel(rule: string, timeZone: string): string {
  const spec = parseRecurrenceRule(rule);
  return spec ? describeRecurrence(spec, timeZone) : '自定义重复';
}

/** 完整日期：9月25日 周五 07:00（非今年时带年份） */
export function formatFullDateTime(date: Date, timeZone: string): string {
  const year = date.getFullYear() === new Date().getFullYear() ? '' : `${date.getFullYear()}年`;
  return (
    `${year}${date.getMonth() + 1}月${date.getDate()}日 ` +
    `周${weekdayName(weekdayOf(date, timeZone))} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Date → <input type="date"> 的值（本地日期） */
export function toDateValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** <input type="date"> 的值 → 本地当天 00:00；空字符串为 null */
export function fromDateValue(value: string): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}
