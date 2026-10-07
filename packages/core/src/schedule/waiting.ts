import type { CalendarDate } from './calendar-date';
import type { RelationAnchor, RelationSide, TaskRelation } from './schedule-dates';

/**
 * 等待：任务的关系对象还没到它等的那一步时，这个任务在等待（清单里状态不变）。
 * - 等对方"结束"：看对方实际是否完成（开了任务分配的项目里以负责人确认为准，即 confirmedAt）
 * - 等对方"开始"：看对方自己的开始条件是否满足——固定日期就看是否到了那天；
 *   是关系就看它等的那些事是否都已发生（逐层往上判断）；没有开始条件的算已开始；已完成的算已开始
 */

export interface WaitingTask {
  id: string;
  startOn: CalendarDate | null;
  /** 已确认完成的时间（个人和没开任务分配的项目完成即确认） */
  confirmedAt: Date | null;
  deletedAt?: Date | null;
}

export interface WaitingContext {
  tasks: ReadonlyMap<string, WaitingTask>;
  relationsByTask: ReadonlyMap<string, readonly TaskRelation[]>;
  /** 今天（用户时区） */
  today: CalendarDate;
}

export interface WaitingOn {
  predecessorId: string;
  anchor: RelationAnchor;
}

/** 对方的这一步有没有发生；看不到的、已删除的关系对象不挡人 */
export function hasHappened(
  predecessorId: string,
  anchor: RelationAnchor,
  context: WaitingContext,
): boolean {
  const task = context.tasks.get(predecessorId);
  if (!task || task.deletedAt) return true;
  if (anchor === 'end') return task.confirmedAt !== null;
  return hasStarted(predecessorId, context, new Set());
}

function hasStarted(taskId: string, context: WaitingContext, visiting: Set<string>): boolean {
  const task = context.tasks.get(taskId);
  if (!task || task.deletedAt || task.confirmedAt !== null) return true;
  if (visiting.has(taskId)) return true;
  visiting.add(taskId);
  const starts = (context.relationsByTask.get(taskId) ?? []).filter((r) => r.side === 'start');
  if (starts.length > 0) {
    return starts.every((r) => {
      const pred = context.tasks.get(r.predecessorId);
      if (!pred || pred.deletedAt) return true;
      return r.anchor === 'end'
        ? pred.confirmedAt !== null
        : hasStarted(r.predecessorId, context, visiting);
    });
  }
  return task.startOn === null || task.startOn <= context.today;
}

/**
 * 这个任务在等哪些（先列开始那一行的，再列结束那一行的）；不在等待时为空。
 * sides 只看其中某一行（例如简介行只显示开始那一行的等待）。
 */
export function waitingOn(
  taskId: string,
  context: WaitingContext,
  sides: readonly RelationSide[] = ['start', 'end'],
): WaitingOn[] {
  const task = context.tasks.get(taskId);
  if (!task || task.confirmedAt !== null) return [];
  const relations = (context.relationsByTask.get(taskId) ?? [])
    .filter((r) => sides.includes(r.side))
    .sort((a, b) => (a.side === b.side ? 0 : a.side === 'start' ? -1 : 1));
  const seen = new Set<string>();
  const result: WaitingOn[] = [];
  for (const r of relations) {
    const key = `${r.predecessorId}:${r.anchor}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!hasHappened(r.predecessorId, r.anchor, context)) {
      result.push({ predecessorId: r.predecessorId, anchor: r.anchor });
    }
  }
  return result;
}
