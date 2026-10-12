import {
  DEFAULT_STATUS_FILTER,
  LIST_SCOPES,
  STATUS_FILTERS,
  daysBetween,
  parseRecurrenceRule,
  type ContainerFeatures,
  IMPORTANCE_KEYS,
  IMPORTANCE_LEVELS_STRONG_FIRST,
  type ImportanceLevel,
  type ListScope,
  type Quadrant,
  type StatusFilter,
} from '@alethego/core';

import { messages } from '@/i18n';

export const SCOPE_LABELS: Record<ListScope, string> = {
  all: '总览',
  today: '今日',
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

/** 重要性的选项：由强到弱（必须、应该、可以、随意） */
export const IMPORTANCE_LEVELS: readonly ImportanceLevel[] = IMPORTANCE_LEVELS_STRONG_FIRST;

/** 重要性的名字（文案集中在 i18n） */
export function importanceLabel(level: ImportanceLevel): string {
  return messages.importance[IMPORTANCE_KEYS[level]];
}

/** 浏览器所在时区 */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const pad = (n: number) => String(n).padStart(2, '0');

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** 日期 → 星期几（0 = 周日，和 Date.getUTCDay 一致） */
function weekdayIndex(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 日期 → "9月30日 周三"（和今天不在同一年时带年份） */
export function formatDate(date: string, today: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const year = date.slice(0, 4) === today.slice(0, 4) ? '' : `${y}年`;
  return `${year}${m}月${d}日 周${WEEKDAYS[weekdayIndex(date)]}`;
}

/**
 * 列表中的截止日期：日期 + 星期 · 剩余天数。截止日期那一天过完才算逾期。
 * - 今天：「今天」
 * - 以后：「9月30日 周三 · 还剩2天」
 * - 已过期：「9月26日 周六 · 逾期2天」
 */
export function formatDeadline(deadline: string, today: string): string {
  const days = daysBetween(today, deadline);
  if (days === 0) return '今天';
  const label = formatDate(deadline, today);
  return days > 0 ? `${label} · 还剩${days}天` : `${label} · 逾期${-days}天`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 循环规则的一句话描述（文案集中在 i18n）；不认识的规则显示为"自定义重复" */
export function recurrenceLabel(rule: string): string {
  const spec = parseRecurrenceRule(rule);
  return spec ? messages.recurrence.describe(spec) : '自定义重复';
}

/** Date → 本地日期 "YYYY-MM-DD"（例如今天） */
export function toDateValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 日历日 → "10月12日 周一"（任务关系、甘特图用） */
export function formatDay(date: string): string {
  const [, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${m}月${d}日 周${WEEKDAYS[weekdayIndex(date)]}`;
}

/** 关系的偏移：0 → 当天，正数 → 后 N 天，负数 → 前 N 天 */
export function formatOffset(days: number): string {
  if (days === 0) return '当天';
  return days > 0 ? `后 ${days} 天` : `前 ${-days} 天`;
}
