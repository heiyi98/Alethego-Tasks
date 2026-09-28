import { calendarDaysBetween, type EvaluationContext } from '../time/zoned-time';
import {
  EXTENDED_TIER_DAYS,
  MODE_TIER_DAYS,
  QUADRANT_LIST_MAX_DAYS,
  urgentThresholdDays,
  type MatrixMode,
} from './tiers';

/**
 * 紧迫度计算结果。每次展示时基于当前时间动态计算，不存储。
 *
 * - scheduled：一年内；dayNumber = N（今天算第 1 天）。落在哪一格取决于矩阵模式，见 cellForDayNumber
 * - far：N > 365（扩展向量），不进入矩阵与四象限清单；extendedTierDays 超出扩展向量时为 null
 * - no_deadline：无截止时间
 * - overdue：已超过截止时刻（只会出现在普通任务上）；overdueDays = 逾期的日历天数，不封顶
 *   （当天已过点为 0）
 */
export type Urgency =
  | { kind: 'scheduled'; dayNumber: number }
  | { kind: 'far'; dayNumber: number; extendedTierDays: number | null }
  | { kind: 'no_deadline' }
  | { kind: 'overdue'; overdueDays: number };

/**
 * N（今天算第 1 天）→ 这种模式下从右往左的第几格（0 = 最右的普通格）；区间上界含在内。
 * 超出这种模式的范围（短期 N > 14，长期 N > 180）返回 null。
 */
export function cellForDayNumber(dayNumber: number, mode: MatrixMode): number | null {
  const index = MODE_TIER_DAYS[mode].findIndex((days) => dayNumber <= days);
  return index === -1 ? null : index;
}

/**
 * 计算紧迫度：按日历日判档，位置只看截止日期（用户时区），不看几点几分。
 * N = (截止日期 − 今天) 的日历天数 + 1。日期型和设了具体时刻的任务落格方式完全相同。
 *
 * 是否逾期看截止时刻：超过截止时刻即逾期（日期型任务的截止时刻是当天最后一刻，
 * 所以从次日 00:00 起逾期；设了具体时刻的从该时刻起，当天已过点也算）。
 */
export function calculateUrgency(deadlineAt: Date | null, context: EvaluationContext): Urgency {
  if (!deadlineAt) return { kind: 'no_deadline' };

  const { now, timeZone } = context;
  if (deadlineAt.getTime() < now.getTime()) {
    return { kind: 'overdue', overdueDays: calendarDaysBetween(deadlineAt, now, timeZone) };
  }

  const dayNumber = calendarDaysBetween(now, deadlineAt, timeZone) + 1;
  if (dayNumber > QUADRANT_LIST_MAX_DAYS) {
    const extendedTierDays = EXTENDED_TIER_DAYS.find((days) => dayNumber <= days) ?? null;
    return { kind: 'far', dayNumber, extendedTierDays };
  }
  return { kind: 'scheduled', dayNumber };
}

/**
 * 是否紧急，跟着矩阵模式：短期 N ≤ 3，长期 N ≤ 14，即中线右边三格；逾期一律紧急。
 * 无截止时间、远期均为不紧急。
 */
export function isUrgent(urgency: Urgency, mode: MatrixMode): boolean {
  switch (urgency.kind) {
    case 'overdue':
      return true;
    case 'scheduled':
      return urgency.dayNumber <= urgentThresholdDays(mode);
    case 'far':
    case 'no_deadline':
      return false;
  }
}
