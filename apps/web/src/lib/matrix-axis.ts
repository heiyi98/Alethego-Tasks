import {
  MATRIX_COLUMNS,
  MATRIX_MIDLINE_BOUNDARY,
  MODE_TIER_DAYS,
  type MatrixMode,
  type MatrixSlot,
} from '@alethego/core';

import { TIER_BOUNDARY_LABELS } from './format';

/**
 * 矩阵横轴：两种模式都是 6 个等宽的格子，刻度名标在分界线上。
 * 分界线编号 b = 0..6：b 是第 b 格的左边界（b = 6 是 6 格的右端，接逾期区）。
 * 第 c 格（c = 0..5，越靠右越紧急）的左边界标这一格 N 的上界；右端（逾期区之前）不标字。
 *   短期：两周、一周、5天、3天（中线）、2天、1天
 *   长期：半年、一季度、一个月、两周（中线）、一周、3天
 *
 * 渲染和单元测试都用这里的同一份刻度，保证"画出来的刻度名"就是测试断言的那个。
 */

export interface AxisTick {
  /** 分界线编号：第几格的左边界 */
  boundary: number;
  label: string;
}

/** 某种模式下所有带名字的刻度，从左到右 */
export function xTicks(mode: MatrixMode): AxisTick[] {
  const days = MODE_TIER_DAYS[mode];
  return Array.from({ length: MATRIX_COLUMNS }, (_, column) => ({
    boundary: column,
    label: TIER_BOUNDARY_LABELS[days[MATRIX_COLUMNS - 1 - column]!]!,
  }));
}

/** 中线所在的分界线：6 格正中，两种模式相同 */
export const MIDLINE_BOUNDARY = MATRIX_MIDLINE_BOUNDARY;

/** 某一格左右两条分界线上画的刻度名（没有刻度名的一侧为 null） */
export function cellSideLabels(
  mode: MatrixMode,
  column: number,
): { left: string | null; right: string | null } {
  const ticks = xTicks(mode);
  const labelAt = (boundary: number) =>
    ticks.find((tick) => tick.boundary === boundary)?.label ?? null;
  return { left: labelAt(column), right: labelAt(column + 1) };
}

/** 图上位置的简短写法（data-column 属性、测试用）：格子序号，或 overdue / no-deadline */
export function slotKey(slot: MatrixSlot): string {
  switch (slot.kind) {
    case 'cell':
      return String(slot.column);
    case 'overdue':
      return 'overdue';
    case 'no_deadline':
      return 'no-deadline';
  }
}
