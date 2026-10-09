/**
 * 子任务：对一个任务内容的拆分，只有标题和勾选；只有一层，没有时间、重要性、RACI、任务关系，
 * 不单独出现在矩阵、甘特图、今日里。删除只做标记（deletedAt），循环任务过去各次的历史保持原样。
 */
export interface Subtask {
  id: string;
  taskId: string;
  title: string;
  position: number;
  createdAt: Date;
  deletedAt: Date | null;
}

/** 一个勾选：普通任务 occurrenceDate 为 null；循环任务每一次各自勾选 */
export interface SubtaskCheck {
  subtaskId: string;
  occurrenceDate: Date | null;
}

/**
 * 某个子任务算不算某一次里的（和数据库的 subtask_applies 一致）：
 * 普通任务（occurrenceDate 为 null）看有没有删除；循环任务的某一次看"那一次之前就有、那一次之后才删"。
 * 所以改清单只影响以后，过去各次保持原样。
 */
export function subtaskApplies(
  subtask: Pick<Subtask, 'createdAt' | 'deletedAt'>,
  occurrenceDate: Date | null,
): boolean {
  if (occurrenceDate === null) return subtask.deletedAt === null;
  return (
    subtask.createdAt.getTime() <= occurrenceDate.getTime() &&
    (subtask.deletedAt === null || subtask.deletedAt.getTime() > occurrenceDate.getTime())
  );
}

/** 某一次（普通任务为 null）的子任务清单，按顺序 */
export function subtasksFor<T extends Subtask>(
  subtasks: readonly T[],
  occurrenceDate: Date | null,
): T[] {
  return subtasks
    .filter((s) => subtaskApplies(s, occurrenceDate))
    .sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime());
}

export function isSubtaskChecked(
  checks: readonly SubtaskCheck[],
  subtaskId: string,
  occurrenceDate: Date | null,
): boolean {
  return checks.some(
    (c) =>
      c.subtaskId === subtaskId &&
      (c.occurrenceDate === null
        ? occurrenceDate === null
        : occurrenceDate !== null && c.occurrenceDate.getTime() === occurrenceDate.getTime()),
  );
}

/** 进度，例如 2/5；没有子任务时 total 为 0 */
export function subtaskProgress(
  subtasks: readonly Subtask[],
  checks: readonly SubtaskCheck[],
  occurrenceDate: Date | null,
): { done: number; total: number } {
  const list = subtasksFor(subtasks, occurrenceDate);
  return {
    done: list.filter((s) => isSubtaskChecked(checks, s.id, occurrenceDate)).length,
    total: list.length,
  };
}
