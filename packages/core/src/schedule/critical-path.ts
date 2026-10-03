import { addDays, daysBetween, latestDate, type CalendarDate } from './calendar-date';
import { topologicalOrder } from './relation-cycles';
import type { RelationAnchor, RelationSide } from './schedule-dates';

/**
 * 浮动时间和关键路径：由日期和关系自动算出。
 * - 终点 = 范围里所有任务最晚的结束日期
 * - 从终点往前推：每个任务最晚可以在哪天结束而不推迟终点、也不推迟依赖它的任务
 * - 浮动时间 = 最晚结束 − 实际结束（天）；浮动为 0（或更少）的任务在关键路径上
 * 任务的工期（结束 − 开始）按现在的日期不变；没有开始的任务按里程碑（工期 0）。
 */

export interface PlanItem {
  id: string;
  start: CalendarDate;
  end: CalendarDate;
}

/** 关系：to 的 side 那一行挂着"于 from 的 anchor，偏移 offsetDays 天" */
export interface PlanLink {
  from: string;
  anchor: RelationAnchor;
  to: string;
  side: RelationSide;
  offsetDays: number;
}

export interface FloatResult {
  /** 终点；没有任务时为 null */
  projectEnd: CalendarDate | null;
  /** 每个任务的浮动时间（天） */
  floatDays: Map<string, number>;
  /** 最晚结束日期 */
  lateEnd: Map<string, CalendarDate>;
  /** 关键路径上的任务 */
  critical: Set<string>;
}

export function computeFloat(items: readonly PlanItem[], links: readonly PlanLink[]): FloatResult {
  const projectEnd = latestDate(items.map((i) => i.end));
  const floatDays = new Map<string, number>();
  const lateEnd = new Map<string, CalendarDate>();
  const critical = new Set<string>();
  if (projectEnd === null) return { projectEnd, floatDays, lateEnd, critical };

  const byId = new Map(items.map((i) => [i.id, i]));
  const inner = links.filter((l) => byId.has(l.from) && byId.has(l.to));
  const duration = (id: string) => daysBetween(byId.get(id)!.start, byId.get(id)!.end);
  const order = topologicalOrder(
    items.map((i) => i.id),
    inner.map((l) => ({ taskId: l.to, predecessorId: l.from })),
  );

  for (const id of [...order].reverse()) {
    let late = projectEnd;
    for (const link of inner.filter((l) => l.from === id)) {
      const successorLateEnd = lateEnd.get(link.to)!;
      const successorLateSide =
        link.side === 'end' ? successorLateEnd : addDays(successorLateEnd, -duration(link.to));
      // 这个任务的 anchor 最晚可以是 successorLateSide − offset
      const limit = addDays(successorLateSide, -link.offsetDays);
      const candidate = link.anchor === 'end' ? limit : addDays(limit, duration(id));
      if (candidate < late) late = candidate;
    }
    lateEnd.set(id, late);
    const float = daysBetween(byId.get(id)!.end, late);
    floatDays.set(id, float);
    if (float <= 0) critical.add(id);
  }
  return { projectEnd, floatDays, lateEnd, critical };
}
