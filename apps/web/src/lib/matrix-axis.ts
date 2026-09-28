import {
  BASE_TIER_DAYS,
  MATRIX_COLUMNS,
  MAX_TIER_INDEX,
  OVERDUE_COLUMN,
  OVERDUE_MATRIX_GRACE_DAYS,
} from '@alethego/core';

import { TIER_BOUNDARY_LABELS } from './format';

/**
 * 矩阵横轴：14 格全部等宽，刻度名标在分界线上。
 * 分界线编号 b = 0..14：b 是第 b 列的左边界（b = 14 是右端）。
 * 第 c 列（c = 0..12）放第 12 − c 档；它的左边界标该档 N 的上界（"1天""2天"……"一年"），
 * 第 12 列与逾期区（第 13 列）之间的分界线、以及右端，都不标字。
 *
 * 渲染和单元测试都用这里的同一份刻度，保证"画出来的刻度名"就是测试断言的那个。
 */

export interface AxisTick {
  /** 分界线编号：第几列的左边界 */
  boundary: number;
  label: string;
}

/** 所有带名字的刻度，从左到右 */
export const X_TICKS: readonly AxisTick[] = Array.from({ length: OVERDUE_COLUMN }, (_, column) => ({
  boundary: column,
  label: TIER_BOUNDARY_LABELS[BASE_TIER_DAYS[MAX_TIER_INDEX - column]!]!,
}));

/** 中线（两周）所在的分界线 */
export const MIDLINE_BOUNDARY = X_TICKS.find((tick) => tick.label === '两周')!.boundary;

/** 某一格左右两条分界线上画的刻度名（没有刻度名的一侧为 null） */
export function cellSideLabels(column: number): { left: string | null; right: string | null } {
  const labelAt = (boundary: number) =>
    X_TICKS.find((tick) => tick.boundary === boundary)?.label ?? null;
  return { left: labelAt(column), right: labelAt(column + 1) };
}

/** 分界线的横坐标 */
export function boundaryX(boundary: number, left: number, cellWidth: number): number {
  return left + boundary * cellWidth;
}

/**
 * 逾期区的道：按逾期的日历天数分三条窄道，越逾期越靠右（0 天 = 当天已过点）。
 * 返回道在逾期格内的中心位置（0..1）。
 */
export function overdueLaneCenter(overdueDays: number): number {
  const lane = Math.min(Math.max(overdueDays, 0), OVERDUE_MATRIX_GRACE_DAYS - 1);
  return (lane + 0.5) / OVERDUE_MATRIX_GRACE_DAYS;
}

export { MATRIX_COLUMNS };
