import type { ImportanceLevel } from '../domain/importance';
import type { RecurrenceOccurrence } from '../domain/occurrence';
import type { Task } from '../domain/task';
import { compareByDeadline } from '../list/task-list-order';
import {
  placeOnMatrix,
  type MatrixHiddenReason,
  type Quadrant,
} from '../quadrant/quadrant-classifier';
import {
  resolveTaskRepresentative,
  toMatrixCandidate,
  type TaskRepresentative,
} from '../representative/task-representative';
import type { EvaluationContext } from '../time/zoned-time';
import { MAX_TIER_INDEX } from '../urgency/tiers';
import type { Urgency } from '../urgency/urgency-calculator';

/**
 * 矩阵布局：把任务放进「紧迫度列 × 重要性行」的逻辑格子，并在格子内散布、避让。
 * 只输出格子索引与格内相对偏移（0-1），像素尺寸由各端表现层决定（Web / Mobile 共用）。
 *
 * 列（从左到右，越靠右越紧急）：
 *   0..13  基本向量档位，列号 = 13 - tierIndex（第 13 档「一年内」与无截止时间在最左列）
 *   14     逾期贴边列：宽限期内的逾期任务贴靠右侧边界
 * 行（从下到上，越靠上越重要）：0..5 即重要性档位，0 = 未设置
 */

export const MATRIX_TIER_COLUMNS = MAX_TIER_INDEX + 1;
export const OVERDUE_COLUMN = MATRIX_TIER_COLUMNS;
export const MATRIX_COLUMNS = MATRIX_TIER_COLUMNS + 1;
export const MATRIX_ROWS = 6;

/** 格内留白：点不贴到格子边缘，相邻格子的点不会互相重叠 */
const CELL_PADDING = 0.14;
/** 格内子网格中的随机扰动幅度（相对子格大小），让点"自由散布"而不是排成方阵 */
const JITTER = 0.35;

export interface MatrixPoint {
  task: Task;
  representative: TaskRepresentative;
  quadrant: Quadrant;
  urgency: Urgency;
  /** 0..14，见文件头注释 */
  column: number;
  /** 0..5 = 重要性 */
  row: ImportanceLevel;
  /** 逾期贴边展示时标注的逾期天数；未逾期为 null */
  overdueDays: number | null;
  /** 在格子内的相对位置，0 = 左 / 下，1 = 右 / 上 */
  offsetX: number;
  offsetY: number;
}

export interface MatrixLayout {
  points: MatrixPoint[];
  /** 未进入矩阵的任务数（已完成 / 已删除 / 循环已结束的任务不计入） */
  hidden: Record<MatrixHiddenReason, number>;
}

export interface MatrixSources {
  tasks: readonly Task[];
  occurrencesByTask?: ReadonlyMap<string, readonly RecurrenceOccurrence[]>;
}

/** 紧迫度 → 列；远期任务不上矩阵，返回 null */
export function columnForUrgency(urgency: Urgency): number | null {
  switch (urgency.kind) {
    case 'scheduled':
      return MAX_TIER_INDEX - urgency.tierIndex;
    case 'no_deadline':
      return 0;
    case 'overdue':
      return OVERDUE_COLUMN;
    case 'far':
      return null;
  }
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

const unit = (input: string, seed?: number) => hash32(input, seed) / 0xffffffff;

/**
 * 同一格子内 n 个点：切成 k×r 的子格，每个点占一个子格并在子格内扰动。
 * 子格互不重叠，因此只要点的直径小于子格尺寸就不会互相遮挡。
 */
function scatterInCell(taskIds: readonly string[]): Map<string, { x: number; y: number }> {
  const ordered = [...taskIds].sort((a, b) => hash32(a) - hash32(b) || (a < b ? -1 : 1));
  const cols = Math.ceil(Math.sqrt(ordered.length));
  const rows = Math.ceil(ordered.length / cols);
  const span = 1 - CELL_PADDING * 2;
  const result = new Map<string, { x: number; y: number }>();
  ordered.forEach((id, index) => {
    const cx = ((index % cols) + 0.5 + (unit(id, 1) - 0.5) * JITTER) / cols;
    const cy = (Math.floor(index / cols) + 0.5 + (unit(id, 2) - 0.5) * JITTER) / rows;
    result.set(id, { x: CELL_PADDING + cx * span, y: CELL_PADDING + cy * span });
  });
  return result;
}

export function buildMatrixLayout(
  sources: MatrixSources,
  context: EvaluationContext,
): MatrixLayout {
  const hidden: Record<MatrixHiddenReason, number> = {
    unprocessed: 0,
    far_future: 0,
    overdue_expired: 0,
  };
  const placed: Omit<MatrixPoint, 'offsetX' | 'offsetY'>[] = [];

  for (const task of sources.tasks) {
    const representative = resolveTaskRepresentative(
      task,
      sources.occurrencesByTask?.get(task.id) ?? [],
      context,
    );
    if (!representative) continue;
    const candidate = toMatrixCandidate(representative, context);
    const placement = placeOnMatrix(candidate);
    if (!placement.visible) {
      hidden[placement.reason] += 1;
      continue;
    }
    placed.push({
      task,
      representative,
      quadrant: placement.quadrant,
      urgency: candidate.urgency,
      column: columnForUrgency(candidate.urgency)!,
      row: candidate.importanceLevel,
      overdueDays: placement.overdueDays,
    });
  }

  const cells = new Map<string, string[]>();
  for (const point of placed) {
    const key = `${point.column}:${point.row}`;
    cells.set(key, [...(cells.get(key) ?? []), point.task.id]);
  }
  const offsets = new Map<string, { x: number; y: number }>();
  for (const ids of cells.values()) {
    for (const [id, offset] of scatterInCell(ids)) offsets.set(id, offset);
  }

  return {
    points: placed.map((point) => {
      const offset = offsets.get(point.task.id)!;
      return { ...point, offsetX: offset.x, offsetY: offset.y };
    }),
    hidden,
  };
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
