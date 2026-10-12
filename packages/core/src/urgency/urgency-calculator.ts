import { daysBetween, type CalendarDate } from '../schedule/calendar-date';
import { todayOf, type EvaluationContext } from '../time/zoned-time';
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
 * - overdue：截止日期已过（只会出现在普通任务上）；overdueDays = 逾期的天数（截止日期的第二天为 1），不封顶
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
 * 计算紧迫度：按日期判档。N = (截止日期 − 今天) 的天数 + 1（今天截止为 1）。
 * 截止日期那一天过完才算逾期：从第二天起逾期。今天按用户所在时区判断。
 */
export function calculateUrgency(
  deadlineOn: CalendarDate | null,
  context: EvaluationContext,
): Urgency {
  if (!deadlineOn) return { kind: 'no_deadline' };

  const today = todayOf(context);
  if (deadlineOn < today) return { kind: 'overdue', overdueDays: daysBetween(deadlineOn, today) };

  const dayNumber = daysBetween(today, deadlineOn) + 1;
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
