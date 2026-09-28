/**
 * 紧迫度标尺，见《02-核心算法与业务逻辑》第 1 节。
 *
 * 按日历日判档：位置只看截止日期（用户时区的日历日），不看几点几分。
 *   N = (截止日期 − 今天) 的日历天数 + 1，今天算第 1 天。
 * 日期型和设了具体时刻的任务落格方式完全相同。标尺是自然天数；斐波那契数列只是当初挑选刻度时的参考。
 *
 * 矩阵横轴共 14 格、全部等宽，中线落在"两周"这条分界线上：
 *   紧急一侧（中线向右）：N = 8–14 → 6–7 → 4–5 → 3 → 2 → 1（今天）→ 逾期区
 *   不紧急一侧（中线向左）：N = 15–21 → 22–30 → 31–60 → 61–90 → 91–180 → 181–270 → 271–365
 */

/** 紧急一侧各档 N 的上界：1天、2天、3天、5天、一周、两周 */
export const URGENT_SIDE_BOUNDARY_DAYS = {
  oneDay: 1,
  twoDays: 2,
  threeDays: 3,
  fiveDays: 5,
  oneWeek: 7,
  twoWeeks: 14,
} as const;

/** 不紧急一侧各档 N 的上界，按自然周、月、季度取值，调整刻度只需改这里 */
export const NOT_URGENT_SIDE_BOUNDARY_DAYS = {
  threeWeeks: 21,
  oneMonth: 30,
  twoMonths: 60,
  oneQuarter: 90,
  halfYear: 180,
  threeQuarters: 270,
  oneYear: 365,
} as const;

/** 超过一年的扩展刻度（N 的上界）：两年、三年、五年、七年、十年。只用于数值描述，不进入矩阵。 */
export const EXTENDED_BOUNDARY_DAYS = {
  twoYears: 730,
  threeYears: 1095,
  fiveYears: 1825,
  sevenYears: 2555,
  tenYears: 3650,
} as const;

/**
 * 基本向量：数组下标即档位序号 tierIndex，值为该档 N 的上界（含）。
 * 第 0 档 = N 为 1（今天）；第 i 档 = BASE_TIER_DAYS[i-1] < N ≤ BASE_TIER_DAYS[i]。
 */
export const BASE_TIER_DAYS: readonly number[] = [
  ...Object.values(URGENT_SIDE_BOUNDARY_DAYS),
  ...Object.values(NOT_URGENT_SIDE_BOUNDARY_DAYS),
];

export const EXTENDED_TIER_DAYS: readonly number[] = Object.values(EXTENDED_BOUNDARY_DAYS);

/** 紧急与不紧急的分界：N ≤ 14（含逾期）为紧急 */
export const URGENT_THRESHOLD_DAYS = URGENT_SIDE_BOUNDARY_DAYS.twoWeeks;

/** 紧急区的最后一档（N 的上界 = 两周） */
export const LAST_URGENT_TIER_INDEX = BASE_TIER_DAYS.indexOf(URGENT_THRESHOLD_DAYS);

/** 基本向量的最大序号；无截止时间的任务归入此档（不紧急端的最远端） */
export const MAX_TIER_INDEX = BASE_TIER_DAYS.length - 1;

/**
 * 逾期区（只针对普通任务）是一条 3 天的时间轴，分三条道：逾期 0 天（当天已过点）、1 天、2 天。
 * 逾期满这个天数的任务退场，只在清单的"已错过"里可见。
 */
export const OVERDUE_MATRIX_GRACE_DAYS = 3;
