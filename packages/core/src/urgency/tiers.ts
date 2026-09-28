/**
 * 紧迫度标尺，见《02-核心算法与业务逻辑》第 1 节。
 *
 * 用剩余时间判档：R = 截止时刻 − 现在（日期型截止时间取当天最后一刻），单位为自然天，
 * 区间上界包含在内，即 (a, b]。标尺是自然天数；斐波那契数列只是当初挑选刻度时的参考，不是实际标尺。
 *
 * 矩阵横轴共 14 格、全部等宽，中线落在"两周"（R = 14 天）这条分界线上：
 *   紧急一侧（中线向右）：(7,14] → (5,7] → (3,5] → (2,3] → (1,2] → (0,1] → 逾期（R ≤ 0）
 *   不紧急一侧（中线向左）：(14,21] → (21,30] → (30,60] → (60,90] → (90,180] → (180,270] → (270,365]
 */

/** 紧急一侧的分界（天）：1 天、2 天、3 天、5 天、一周、两周 */
export const URGENT_SIDE_BOUNDARY_DAYS = {
  oneDay: 1,
  twoDays: 2,
  threeDays: 3,
  fiveDays: 5,
  oneWeek: 7,
  twoWeeks: 14,
} as const;

/** 不紧急一侧的分界（天），按自然周、月、季度取值，调整刻度只需改这里 */
export const NOT_URGENT_SIDE_BOUNDARY_DAYS = {
  threeWeeks: 21,
  oneMonth: 30,
  twoMonths: 60,
  oneQuarter: 90,
  halfYear: 180,
  threeQuarters: 270,
  oneYear: 365,
} as const;

/** 超过一年的扩展刻度（天）：两年、三年、五年、七年、十年。只用于数值描述，不进入矩阵。 */
export const EXTENDED_BOUNDARY_DAYS = {
  twoYears: 730,
  threeYears: 1095,
  fiveYears: 1825,
  sevenYears: 2555,
  tenYears: 3650,
} as const;

/**
 * 基本向量：数组下标即档位序号 tierIndex，值为该档的上界（天，含）。
 * 第 i 档 = (BASE_TIER_DAYS[i-1], BASE_TIER_DAYS[i]]，第 0 档 = (0, 1]。
 */
export const BASE_TIER_DAYS: readonly number[] = [
  ...Object.values(URGENT_SIDE_BOUNDARY_DAYS),
  ...Object.values(NOT_URGENT_SIDE_BOUNDARY_DAYS),
];

export const EXTENDED_TIER_DAYS: readonly number[] = Object.values(EXTENDED_BOUNDARY_DAYS);

/** 紧急与不紧急的分界：R ≤ 14 天（含逾期）为紧急 */
export const URGENT_THRESHOLD_DAYS = URGENT_SIDE_BOUNDARY_DAYS.twoWeeks;

/** 紧急区的最后一档（上界 = 两周） */
export const LAST_URGENT_TIER_INDEX = BASE_TIER_DAYS.indexOf(URGENT_THRESHOLD_DAYS);

/** 基本向量的最大序号；无截止时间的任务归入此档（不紧急端的最远端） */
export const MAX_TIER_INDEX = BASE_TIER_DAYS.length - 1;

/** 逾期任务在矩阵右边界的展示宽限期（天）；超过后退出矩阵图，仅列表可见。 */
export const OVERDUE_MATRIX_GRACE_DAYS = 3;

export const MS_PER_DAY = 86_400_000;
