import { calendarDaysBetween, type EvaluationContext } from '../time/zoned-time';
import {
  BASE_TIER_DAYS,
  EXTENDED_TIER_DAYS,
  LAST_URGENT_TIER_INDEX,
  MAX_TIER_INDEX,
  MS_PER_DAY,
} from './tiers';

/**
 * 紧迫度计算结果。每次展示时基于当前时间动态计算，不存储。
 *
 * - scheduled：一年内（基本向量），tierIndex 0-12
 * - far：超过一年（扩展向量），不进入矩阵；extendedTierDays 超出扩展向量时为 null
 * - no_deadline：无截止时间，按最大档（tierIndex = MAX_TIER_INDEX）计
 * - overdue：已逾期（R ≤ 0）；overdueDays 按日历天计，不封顶（当天稍早已过则为 0）
 *
 * daysRemaining 是剩余时间 R 折算的天数（可带小数），不是日历天数差。
 */
export type Urgency =
  | { kind: 'scheduled'; daysRemaining: number; tierIndex: number; tierDays: number }
  | { kind: 'far'; daysRemaining: number; extendedTierDays: number | null }
  | { kind: 'no_deadline'; tierIndex: number }
  | { kind: 'overdue'; overdueDays: number };

/** 剩余天数（R，可带小数，须 > 0）→ 基本向量档位序号；区间上界含在内；超过一年返回 null。 */
export function tierIndexForDays(daysRemaining: number): number | null {
  const index = BASE_TIER_DAYS.findIndex((days) => daysRemaining <= days);
  return index === -1 ? null : index;
}

/**
 * 计算紧迫度：用剩余时间 R = 截止时刻 − 现在判档，而不是日历天数差。
 * 日期型截止时间在存储时已取当天最后一刻（用户时区），选了具体时刻的直接用该时刻。
 * 例：现在 10:00，截止明天 09:00 → R = 23 小时 → (0, 1] 档；截止明天全天 → R ≈ 1.58 天 → (1, 2] 档。
 */
export function calculateUrgency(deadlineAt: Date | null, context: EvaluationContext): Urgency {
  if (!deadlineAt) return { kind: 'no_deadline', tierIndex: MAX_TIER_INDEX };

  const { now, timeZone } = context;
  const remainingMs = deadlineAt.getTime() - now.getTime();
  if (remainingMs <= 0) {
    // 逾期天数的显示规则不变：按日历天计
    return { kind: 'overdue', overdueDays: calendarDaysBetween(deadlineAt, now, timeZone) };
  }

  const daysRemaining = remainingMs / MS_PER_DAY;
  const tierIndex = tierIndexForDays(daysRemaining);
  if (tierIndex === null) {
    const extendedTierDays = EXTENDED_TIER_DAYS.find((days) => daysRemaining <= days) ?? null;
    return { kind: 'far', daysRemaining, extendedTierDays };
  }
  return { kind: 'scheduled', daysRemaining, tierIndex, tierDays: BASE_TIER_DAYS[tierIndex]! };
}

/** 是否落在紧急区：R ≤ 14 天（含逾期）。无截止时间、远期均为不紧急。 */
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
