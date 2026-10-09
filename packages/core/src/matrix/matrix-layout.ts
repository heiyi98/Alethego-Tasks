import type { ImportanceLevel } from '../domain/importance';
import type { RecurrenceOccurrence } from '../domain/occurrence';
import type { Task } from '../domain/task';
import { compareByDeadline } from '../list/task-list-order';
import {
  placeOnMatrix,
  type MatrixHiddenReason,
  type MatrixSlot,
  type Quadrant,
} from '../quadrant/quadrant-classifier';
import {
  resolveTaskRepresentative,
  toMatrixCandidate,
  type TaskRepresentative,
} from '../representative/task-representative';
import type { EvaluationContext } from '../time/zoned-time';
import { MATRIX_CELLS, URGENT_CELLS, type MatrixMode } from '../urgency/tiers';
import type { Urgency } from '../urgency/urgency-calculator';

/**
 * 矩阵布局：把任务放进「紧迫度格 × 重要性行」的逻辑位置，并给出每个任务按 id 固定的格内偏移。
 * 只输出格子索引与格内相对偏移（0-1），像素尺寸、圆点错开与标签排布由各端表现层决定。
 *
 * 横向（从左到右，越靠右越紧急）：6 个等宽的格子（column 0..5），中线在第 3 格的左边界；
 * 逾期区接在 6 格最右边（1/4 格宽）；没设截止日期的任务贴在图的最左边缘。
 * 纵向（从下到上，越靠上越重要）：0..3 即重要性四档，0 = 随意、3 = 必须。
 */

export const MATRIX_COLUMNS = MATRIX_CELLS;
export const MATRIX_ROWS = 4;
/** 纵向的中线："可以"和"应该"之间（第 2 条分界线），上下各两档 */
export const MATRIX_ROW_MIDLINE = 2;
/** 中线所在的分界线（第几格的左边界）：6 格正中 */
export const MATRIX_MIDLINE_BOUNDARY = MATRIX_CELLS - URGENT_CELLS;

export interface MatrixPoint {
  task: Task;
  representative: TaskRepresentative;
  /** 按当前模式判定的象限 */
  quadrant: Quadrant;
  urgency: Urgency;
  /** 图上的位置；null = 超出当前模式范围，只在四象限清单里显示 */
  slot: MatrixSlot | null;
  /** 0..5 = 重要性 */
  row: ImportanceLevel;
  /** 逾期任务的逾期天数；未逾期为 null */
  overdueDays: number | null;
  /** 按任务 id 固定的格内相对偏移，0 = 左 / 下，1 = 右 / 上；刷新不会变 */
  offsetX: number;
  offsetY: number;
}

export interface MatrixLayout {
  /** 进入矩阵视图的任务（四象限清单）；其中 slot 不为 null 的画在图上 */
  points: MatrixPoint[];
  /** 未进入矩阵视图的任务数（已完成 / 已删除 / 循环已结束的任务不计入） */
  hidden: Record<MatrixHiddenReason, number>;
}

export interface MatrixSources {
  tasks: readonly Task[];
  occurrencesByTask?: ReadonlyMap<string, readonly RecurrenceOccurrence[]>;
}

/** FNV-1a：由任务 id 得到稳定的伪随机数，同一任务每次渲染位置不变 */
function hash32(input: string, seed = 0x811c9dc5): number {
  let hash = seed;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** 任务 id → 固定的格内偏移（0..1） */
export function offsetForId(id: string): { x: number; y: number } {
  return { x: hash32(id, 0x9e3779b9) / 0xffffffff, y: hash32(id, 0x85ebca6b) / 0xffffffff };
}

export function buildMatrixLayout(
  sources: MatrixSources,
  context: EvaluationContext,
  mode: MatrixMode,
): MatrixLayout {
  const hidden: Record<MatrixHiddenReason, number> = {
    unprocessed: 0,
    far_future: 0,
    overdue_expired: 0,
  };
  const points: MatrixPoint[] = [];

  for (const task of sources.tasks) {
    const representative = resolveTaskRepresentative(
      task,
      sources.occurrencesByTask?.get(task.id) ?? [],
      context,
    );
    if (!representative) continue;
    const candidate = toMatrixCandidate(representative, context);
    const placement = placeOnMatrix(candidate, mode);
    if (!placement.visible) {
      hidden[placement.reason] += 1;
      continue;
    }
    const offset = offsetForId(task.id);
    points.push({
      task,
      representative,
      quadrant: placement.quadrant,
      urgency: candidate.urgency,
      slot: placement.slot,
      row: candidate.importanceLevel,
      overdueDays: placement.overdueDays,
      offsetX: offset.x,
      offsetY: offset.y,
    });
  }

  return { points, hidden };
}

/** 象限展示顺序：重要且紧急 → 重要不紧急 → 紧急不重要 → 不重要不紧急 */
export const QUADRANT_ORDER: readonly Quadrant[] = [
  'important_urgent',
  'important_not_urgent',
  'not_important_urgent',
  'not_important_not_urgent',
];

/** 象限列表视图：按象限分组，组内按（代表实例的）截止时间从近到远 */
export function groupPointsByQuadrant(
  points: readonly MatrixPoint[],
): Record<Quadrant, MatrixPoint[]> {
  const groups = Object.fromEntries(QUADRANT_ORDER.map((q) => [q, [] as MatrixPoint[]])) as Record<
    Quadrant,
    MatrixPoint[]
  >;
  for (const point of points) groups[point.quadrant].push(point);
  const sortKey = (p: MatrixPoint) => ({
    id: p.task.id,
    createdAt: p.task.createdAt,
    deadlineAt: p.representative.deadlineAt,
  });
  for (const quadrant of QUADRANT_ORDER) {
    groups[quadrant].sort((a, b) => compareByDeadline(sortKey(a), sortKey(b)));
  }
  return groups;
}
