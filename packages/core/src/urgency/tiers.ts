/**
 * 紧迫度分档（斐波那契），见《02-核心算法与业务逻辑》第 1 节。
 * 数组下标即刻度序号 tier_index，值为该档对应的天数上限。
 */
export const BASE_TIER_DAYS = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377] as const;

/** 扩展向量（超过一年）：数值上继续计算，但不进入矩阵可视化。 */
export const EXTENDED_TIER_DAYS = [610, 987, 1597, 2584, 4181] as const;

/** 紧急区的最后一格（序号 0-6 为紧急，7-13 为不紧急）。 */
export const LAST_URGENT_TIER_INDEX = 6;

/** 基本向量的最大序号；无截止时间的任务归入此档（不紧急端的最远端）。 */
export const MAX_TIER_INDEX = BASE_TIER_DAYS.length - 1;

/** 逾期任务在矩阵右边界的展示宽限期（天）；超过后退出矩阵图，仅列表可见。 */
export const OVERDUE_MATRIX_GRACE_DAYS = 3;
