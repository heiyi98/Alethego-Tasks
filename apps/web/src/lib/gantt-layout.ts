import {
  addDays,
  computeFloat,
  dayNumber,
  daysBetween,
  type CalendarDate,
  type PlanLink,
  type Task,
  type TaskRelation,
} from '@alethego/core';

import { taskDates } from './schedule';

/**
 * 甘特图的排布（不涉及画法）：
 * - 一个任务一行，按开始日期排序；不合并时间不重叠的任务
 * - 有开始和结束：任务条；只有结束（或开始和结束同一天）：里程碑；只有开始：按一天的任务条；
 *   两个都没有：放在最下面的"未排期"区
 * - 浮动时间和关键路径按整个范围（这个项目 / 这个分类）的任务算，终点是范围里最晚的结束
 * - 关系只画两端都在图上的
 */

export type GanttScale = 'day' | 'week' | 'month';

/** 每一天的宽度（像素） */
export const PX_PER_DAY: Record<GanttScale, number> = { day: 32, week: 12, month: 4 };

export type GanttStatus = 'todo' | 'pending' | 'completed';

export interface GanttRow {
  task: Task;
  start: CalendarDate;
  end: CalendarDate;
  milestone: boolean;
  /** 浮动时间（天），不小于 0 */
  float: number;
  critical: boolean;
  status: GanttStatus;
}

export interface GanttLayout {
  rows: GanttRow[];
  unscheduled: Task[];
  links: (PlanLink & { critical: boolean })[];
  /** 时间轴的范围（含两端） */
  from: CalendarDate;
  to: CalendarDate;
}

export function ganttStatus(task: Pick<Task, 'completedAt' | 'confirmedAt'>): GanttStatus {
  if (task.confirmedAt) return 'completed';
  return task.completedAt ? 'pending' : 'todo';
}

export function buildGantt(input: {
  /** 图上显示的任务（按状态行筛过） */
  tasks: readonly Task[];
  /** 整个范围的任务（算浮动时间和关键路径用） */
  scopeTasks: readonly Task[];
  relationsByTask: ReadonlyMap<string, readonly TaskRelation[]>;
  timeZone: string;
  today: CalendarDate;
}): GanttLayout {
  const { timeZone, today } = input;
  const placed = (task: Task) => {
    const dates = taskDates(task, timeZone);
    if (dates.end) return { start: dates.start ?? dates.end, end: dates.end };
    if (dates.start) return { start: dates.start, end: dates.start };
    return null;
  };

  const scopeItems = input.scopeTasks.flatMap((task) => {
    const p = placed(task);
    // 开始晚于结束（关系还没理顺）时按结束当天的里程碑算
    return p ? [{ id: task.id, start: p.start <= p.end ? p.start : p.end, end: p.end }] : [];
  });
  const scopeIds = new Set(scopeItems.map((i) => i.id));
  const allLinks: PlanLink[] = [];
  for (const task of input.scopeTasks) {
    for (const r of input.relationsByTask.get(task.id) ?? []) {
      if (scopeIds.has(r.predecessorId) && scopeIds.has(r.taskId)) {
        allLinks.push({
          from: r.predecessorId,
          anchor: r.anchor,
          to: r.taskId,
          side: r.side,
          offsetDays: r.offsetDays,
        });
      }
    }
  }
  const float = computeFloat(scopeItems, allLinks);

  const rows: GanttRow[] = [];
  const unscheduled: Task[] = [];
  for (const task of input.tasks) {
    const p = placed(task);
    if (!p) {
      unscheduled.push(task);
      continue;
    }
    const start = p.start <= p.end ? p.start : p.end;
    const dates = taskDates(task, timeZone);
    rows.push({
      task,
      start,
      end: p.end,
      milestone: dates.end !== null && (dates.start === null || dates.start === dates.end),
      float: Math.max(0, float.floatDays.get(task.id) ?? 0),
      critical: float.critical.has(task.id),
      status: ganttStatus(task),
    });
  }
  rows.sort(
    (a, b) =>
      a.start.localeCompare(b.start) ||
      a.end.localeCompare(b.end) ||
      a.task.title.localeCompare(b.task.title),
  );
  unscheduled.sort((a, b) => a.title.localeCompare(b.title));

  const shown = new Set(rows.map((r) => r.task.id));
  const links = allLinks
    .filter((l) => shown.has(l.from) && shown.has(l.to))
    .map((l) => ({ ...l, critical: float.critical.has(l.from) && float.critical.has(l.to) }));

  const starts = rows.map((r) => r.start);
  const ends = rows.map((r) => addDays(r.end, r.float));
  const from = addDays(
    [today, ...starts].reduce((a, b) => (a < b ? a : b)),
    -3,
  );
  const to = addDays(
    [today, ...ends].reduce((a, b) => (a > b ? a : b)),
    14,
  );
  return { rows, unscheduled, links, from, to };
}

/** 日期在时间轴上的位置（像素，那一天的左边缘） */
export function dayOffset(date: CalendarDate, from: CalendarDate, scale: GanttScale): number {
  return daysBetween(from, date) * PX_PER_DAY[scale];
}

/** 时间轴的刻度：上面一行（月 / 年）和下面一行（日 / 周 / 月） */
export function ganttTicks(
  from: CalendarDate,
  to: CalendarDate,
  scale: GanttScale,
): {
  major: { date: CalendarDate; label: string }[];
  minor: { date: CalendarDate; label: string }[];
} {
  const major: { date: CalendarDate; label: string }[] = [];
  const minor: { date: CalendarDate; label: string }[] = [];
  const total = daysBetween(from, to);
  for (let i = 0; i <= total; i++) {
    const date = addDays(from, i);
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    const weekday = new Date(dayNumber(date) * 86_400_000).getUTCDay();
    if (scale === 'month') {
      if (d === 1 || i === 0) minor.push({ date, label: `${m}月` });
      if ((m === 1 && d === 1) || i === 0) major.push({ date, label: `${y}年` });
    } else {
      if (d === 1 || i === 0) major.push({ date, label: `${m}月` });
      if (scale === 'day') minor.push({ date, label: String(d) });
      else if (weekday === 1) minor.push({ date, label: `${m}/${d}` });
    }
  }
  return { major, minor };
}
