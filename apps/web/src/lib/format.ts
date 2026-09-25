import {
  calendarDaysBetween,
  type ImportanceLevel,
  type Quadrant,
  type StatusFilter,
} from '@alethego/core';

export const STATUS_LABELS: Record<StatusFilter, string> = {
  todo: '待办',
  missed: '已错过',
  completed: '已完成',
  all: '全部',
};

export const QUADRANT_LABELS: Record<Quadrant, string> = {
  important_urgent: '重要且紧急',
  important_not_urgent: '重要不紧急',
  not_important_urgent: '紧急不重要',
  not_important_not_urgent: '不重要不紧急',
};

/**
 * 矩阵 X 轴刻度，从左到右对应第 13 档 → 第 0 档（越靠右越紧急）。
 * 最左列同时容纳"一年内"与无截止时间的任务。
 */
export const TIER_TICK_LABELS = [
  '1年内',
  '9个月',
  '半年',
  '3个月',
  '2个月',
  '1个月',
  '3周',
  '2周',
  '1周',
  '5天',
  '3天',
  '后天',
  '明天',
  '今天',
] as const;

export const IMPORTANCE_LEVELS: readonly ImportanceLevel[] = [0, 1, 2, 3, 4, 5];

export function importanceLabel(level: ImportanceLevel): string {
  return level === 0 ? '未设置' : String(level);
}

/** 浏览器所在时区 */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 列表中的截止时间：今天 / 明天 / 昨天 + 时刻，其余显示日期 */
export function formatDeadline(deadline: Date, now: Date, timeZone: string): string {
  const time = `${pad(deadline.getHours())}:${pad(deadline.getMinutes())}`;
  const days = calendarDaysBetween(now, deadline, timeZone);
  if (days === 0) return `今天 ${time}`;
  if (days === 1) return `明天 ${time}`;
  if (days === -1) return `昨天 ${time}`;
  const date = `${deadline.getMonth() + 1}月${deadline.getDate()}日`;
  const year = deadline.getFullYear() === now.getFullYear() ? '' : `${deadline.getFullYear()}年`;
  return `${year}${date} ${time}`;
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
