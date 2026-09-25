import { calendarDaysBetween, type EvaluationContext } from '../time/zoned-time';
import {
  BASE_TIER_DAYS,
  EXTENDED_TIER_DAYS,
  LAST_URGENT_TIER_INDEX,
  MAX_TIER_INDEX,
} from './tiers';

/**
 * 紧迫度计算结果。每次展示时基于当前时间动态计算，不存储。
 *
 * - scheduled：一年内（基本向量），tierIndex 0-13
 * - far：超过一年（扩展向量），不进入矩阵；extendedTierDays 超出扩展向量时为 null
 * - no_deadline：无截止时间，按最大档（tierIndex = 13）计
 * - overdue：已逾期，overdueDays 不封顶（截止时间当天稍早已过则为 0）
 */
export type Urgency =
  | { kind: 'scheduled'; daysRemaining: number; tierIndex: number; tierDays: number }
  | { kind: 'far'; daysRemaining: number; extendedTierDays: number | null }
  | { kind: 'no_deadline'; tierIndex: typeof MAX_TIER_INDEX }
  | { kind: 'overdue'; overdueDays: number };

/** 剩余天数 → 基本向量档位序号；超过一年返回 null。 */
export function tierIndexForDays(daysRemaining: number): number | null {
  const index = BASE_TIER_DAYS.findIndex((days) => days >= daysRemaining);
  return index === -1 ? null : index;
}

/**
 * 计算紧迫度。
 * 剩余天数按用户时区的日历日差计算：今天截止 = 0，明天 = 1……，
 * 再取"天数 ≥ 剩余天数"的最小一档（例如剩 4 天 → 第 4 档"五天内"）。
 */
export function calculateUrgency(deadlineAt: Date | null, context: EvaluationContext): Urgency {
  if (!deadlineAt) return { kind: 'no_deadline', tierIndex: MAX_TIER_INDEX };

  const { now, timeZone } = context;
  if (deadlineAt.getTime() < now.getTime()) {
    return { kind: 'overdue', overdueDays: calendarDaysBetween(deadlineAt, now, timeZone) };
  }

  const daysRemaining = calendarDaysBetween(now, deadlineAt, timeZone);
  const tierIndex = tierIndexForDays(daysRemaining);
  if (tierIndex === null) {
    const extendedTierDays = EXTENDED_TIER_DAYS.find((days) => days >= daysRemaining) ?? null;
    return { kind: 'far', daysRemaining, extendedTierDays };
  }
  return { kind: 'scheduled', daysRemaining, tierIndex, tierDays: BASE_TIER_DAYS[tierIndex]! };
}

/** 是否落在紧急区：序号 0-6，或已逾期。无截止时间、远期均为不紧急。 */
export function isUrgent(urgency: Urgency): boolean {
  switch (urgency.kind) {
    case 'overdue':
      return true;
    case 'scheduled':
      return urgency.tierIndex <= LAST_URGENT_TIER_INDEX;
    case 'far':
    case 'no_deadline':
      return false;
  }
}
