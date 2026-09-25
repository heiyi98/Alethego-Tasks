import { IMPORTANCE_UNSET, isImportant } from '../domain/importance';
import { OVERDUE_MATRIX_GRACE_DAYS } from '../urgency/tiers';
import { isUrgent } from '../urgency/urgency-calculator';
import type { MatrixCandidate } from './matrix-candidate';

/** 象限：由（紧急/不紧急 × 重要/不重要）派生的展示分组，不存储为任务字段。 */
export type Quadrant =
  'important_urgent' | 'important_not_urgent' | 'not_important_urgent' | 'not_important_not_urgent';

/** 矩阵图上不显示的原因。 */
export type MatrixHiddenReason =
  /** 重要性为 0 且无截止时间：用户两者都未处理 */
  | 'unprocessed'
  /** 远期任务（扩展向量，超过一年） */
  | 'far_future'
  /** 逾期超过展示宽限期 */
  | 'overdue_expired';

export type MatrixPlacement =
  | {
      visible: true;
      quadrant: Quadrant;
      /** 逾期任务贴靠右边界并标红，此处为需标注的逾期天数；未逾期为 null */
      overdueDays: number | null;
    }
  | { visible: false; reason: MatrixHiddenReason };

function isUnprocessed(candidate: MatrixCandidate): boolean {
  return candidate.importanceLevel === IMPORTANCE_UNSET && candidate.urgency.kind === 'no_deadline';
}

/**
 * 象限判定。四个象限均为合法区域；
 * 唯一没有象限的情况是"重要性为 0 且无截止时间"，返回 null。
 */
export function classifyQuadrant(candidate: MatrixCandidate): Quadrant | null {
  if (isUnprocessed(candidate)) return null;
  const important = isImportant(candidate.importanceLevel);
  const urgent = isUrgent(candidate.urgency);
  if (important) return urgent ? 'important_urgent' : 'important_not_urgent';
  return urgent ? 'not_important_urgent' : 'not_important_not_urgent';
}

/** 矩阵图展示判定：在象限判定之上叠加远期、逾期宽限期规则。 */
export function placeOnMatrix(candidate: MatrixCandidate): MatrixPlacement {
  const quadrant = classifyQuadrant(candidate);
  if (quadrant === null) return { visible: false, reason: 'unprocessed' };

  const { urgency } = candidate;
  if (urgency.kind === 'far') return { visible: false, reason: 'far_future' };
  if (urgency.kind === 'overdue') {
    if (urgency.overdueDays > OVERDUE_MATRIX_GRACE_DAYS) {
      return { visible: false, reason: 'overdue_expired' };
    }
    return { visible: true, quadrant, overdueDays: urgency.overdueDays };
  }
  return { visible: true, quadrant, overdueDays: null };
}
