/**
 * 紧迫度标尺，见《02-核心算法与业务逻辑》第 1 节。
 *
 * 按日历日判档：位置只看截止日期（用户时区的日历日），不看几点几分。
 *   N = (截止日期 − 今天) 的日历天数 + 1，今天算第 1 天。
 * 日期型和设了具体时刻的任务落格方式完全相同。标尺是自然天数；斐波那契数列只是当初挑选刻度时的参考。
 *
 * 矩阵分"短期""长期"两种模式，都是 6 个等宽的格子，竖直中线在 6 格正中；
 * 逾期区不算在 6 格里，是接在最右边的额外一段（1/4 格宽）。
 *   短期（今天到两周），从左到右：N = 8–14、6–7、4–5 ｜中线｜ 3、2、1
 *   长期，从左到右：N = 91–180、31–90、15–30 ｜中线｜ 8–14、4–7、1–3
 * 每种模式下中线右边三格为"紧急"。
 */

export type MatrixMode = 'short' | 'long';

/** 默认模式 */
export const DEFAULT_MATRIX_MODE: MatrixMode = 'short';

/** 短期模式各格 N 的上界（从右到左）：1天、2天、3天、5天、一周、两周 */
export const SHORT_TERM_BOUNDARY_DAYS = {
  oneDay: 1,
  twoDays: 2,
  threeDays: 3,
  fiveDays: 5,
  oneWeek: 7,
  twoWeeks: 14,
} as const;

/** 长期模式各格 N 的上界（从右到左）：3天、一周、两周、一个月、一季度、半年 */
export const LONG_TERM_BOUNDARY_DAYS = {
  threeDays: 3,
  oneWeek: 7,
  twoWeeks: 14,
  oneMonth: 30,
  oneQuarter: 90,
  halfYear: 180,
} as const;

/**
 * 每种模式的格子：下标 i = 从右往左第 i 格（0 = 最右的普通格），值为该格 N 的上界（含）。
 * 第 i 格 = MODE_TIER_DAYS[i-1] < N ≤ MODE_TIER_DAYS[i]。
 */
export const MODE_TIER_DAYS: Readonly<Record<MatrixMode, readonly number[]>> = {
  short: Object.values(SHORT_TERM_BOUNDARY_DAYS),
  long: Object.values(LONG_TERM_BOUNDARY_DAYS),
};

/** 每种模式的格子数（6） */
export const MATRIX_CELLS = 6;

/** 中线右边的格子数：这些格子是"紧急" */
export const URGENT_CELLS = MATRIX_CELLS / 2;

/** 紧急的上界：短期 N ≤ 3，长期 N ≤ 14（逾期一律紧急） */
export function urgentThresholdDays(mode: MatrixMode): number {
  return MODE_TIER_DAYS[mode][URGENT_CELLS - 1]!;
}

/** 这种模式下图上能显示的最大 N：短期 14，长期 180；更远的不画 */
export function modeMaxDays(mode: MatrixMode): number {
  return MODE_TIER_DAYS[mode][MATRIX_CELLS - 1]!;
}

/**
 * 进入四象限清单的最大 N（一年）。清单里显示哪些任务与模式无关：超过一年的远期任务不进清单。
 */
export const QUADRANT_LIST_MAX_DAYS = 365;

/** 超过一年的扩展刻度（N 的上界）：两年、三年、五年、七年、十年。只用于数值描述，不进入矩阵。 */
export const EXTENDED_BOUNDARY_DAYS = {
  twoYears: 730,
  threeYears: 1095,
  fiveYears: 1825,
  sevenYears: 2555,
  tenYears: 3650,
} as const;

export const EXTENDED_TIER_DAYS: readonly number[] = Object.values(EXTENDED_BOUNDARY_DAYS);

/**
 * 逾期区（只针对普通任务）：逾期满这个天数的任务退场，只在清单的"已错过"里可见。
 */
export const OVERDUE_MATRIX_GRACE_DAYS = 3;
