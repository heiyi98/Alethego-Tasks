import { IMPORTANCE_UNSET, isImportant } from '../domain/importance';
import { MATRIX_CELLS, OVERDUE_MATRIX_GRACE_DAYS, type MatrixMode } from '../urgency/tiers';
import { cellForDayNumber, isUrgent } from '../urgency/urgency-calculator';
import type { MatrixCandidate } from './matrix-candidate';

/** 象限：由（紧急/不紧急 × 重要/不重要）派生的展示分组，不存储为任务字段。 */
export type Quadrant =
  'important_urgent' | 'important_not_urgent' | 'not_important_urgent' | 'not_important_not_urgent';

/** 不进入矩阵视图（图与四象限清单都不显示）的原因。 */
export type MatrixHiddenReason =
  /** 重要性为 0 且无截止时间：用户两者都未处理 */
  | 'unprocessed'
  /** 远期任务（超过一年） */
  | 'far_future'
  /** 逾期超过展示宽限期 */
  | 'overdue_expired';

/**
 * 任务在矩阵图上的位置：
 * - cell：6 个普通格之一，column 从左到右 0..5（越靠右越紧急）
 * - no_deadline：没设截止日期（但设了重要性），圆点贴在图的最左边缘
 * - overdue：逾期区（接在 6 格最右边的一小段）
 */
export type MatrixSlot =
  | { kind: 'cell'; column: number }
  | { kind: 'no_deadline' }
  | { kind: 'overdue'; overdueDays: number };

export type MatrixPlacement =
  | {
      visible: true;
      quadrant: Quadrant;
      /** 逾期任务的逾期天数；未逾期为 null */
      overdueDays: number | null;
      /** 图上的位置；超出当前模式范围（短期 N > 14，长期 N > 180）为 null，只在四象限清单里显示 */
      slot: MatrixSlot | null;
    }
  | { visible: false; reason: MatrixHiddenReason };

function isUnprocessed(candidate: MatrixCandidate): boolean {
  return candidate.importanceLevel === IMPORTANCE_UNSET && candidate.urgency.kind === 'no_deadline';
}

/**
 * 象限判定。紧急 / 不紧急跟着矩阵模式：中线右边三格为紧急（短期 N ≤ 3，长期 N ≤ 14，逾期一律紧急）。
 * 重要 / 不重要与模式无关。四个象限均为合法区域；
 * 唯一没有象限的情况是"重要性为 0 且无截止时间"，返回 null。
 */
export function classifyQuadrant(candidate: MatrixCandidate, mode: MatrixMode): Quadrant | null {
  if (isUnprocessed(candidate)) return null;
  const important = isImportant(candidate.importanceLevel);
  const urgent = isUrgent(candidate.urgency, mode);
  if (important) return urgent ? 'important_urgent' : 'important_not_urgent';
  return urgent ? 'not_important_urgent' : 'not_important_not_urgent';
}

/**
 * 矩阵视图判定：在象限判定之上叠加远期、逾期宽限期规则，并给出图上的位置。
 * 哪些任务进入矩阵视图（四象限清单）与模式无关；图上画不画、画在哪一格跟着模式。
 */
export function placeOnMatrix(candidate: MatrixCandidate, mode: MatrixMode): MatrixPlacement {
  const quadrant = classifyQuadrant(candidate, mode);
  if (quadrant === null) return { visible: false, reason: 'unprocessed' };

  const { urgency } = candidate;
  switch (urgency.kind) {
    case 'far':
      return { visible: false, reason: 'far_future' };
    case 'overdue':
      // 逾期满 3 天退场
      if (urgency.overdueDays >= OVERDUE_MATRIX_GRACE_DAYS) {
        return { visible: false, reason: 'overdue_expired' };
      }
      return {
        visible: true,
        quadrant,
        overdueDays: urgency.overdueDays,
        slot: { kind: 'overdue', overdueDays: urgency.overdueDays },
      };
    case 'no_deadline':
      return { visible: true, quadrant, overdueDays: null, slot: { kind: 'no_deadline' } };
    case 'scheduled': {
      const fromRight = cellForDayNumber(urgency.dayNumber, mode);
      return {
        visible: true,
        quadrant,
        overdueDays: null,
        slot: fromRight === null ? null : { kind: 'cell', column: MATRIX_CELLS - 1 - fromRight },
      };
    }
  }
}
