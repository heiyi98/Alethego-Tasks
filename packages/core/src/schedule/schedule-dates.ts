import { addDays, latestDate, type CalendarDate } from './calendar-date';

/**
 * 任务的两行逻辑：怎么开始、怎么结束。
 * - 开始：固定日期，或者"于〔某任务〕的〔开始 / 结束〕"（可以挂多个，取最晚）
 * - 结束：固定日期（就是截止时间），或者关系，或者"开始后 N 天"
 * 每个关系有偏移：正数 = 后 N 天，负数 = 前 N 天。关系对象没有日期时这个关系不算。
 * 数据库里有同样的算法（触发器 tasks_schedule_compute），这里用于界面上的预览、甘特图和等待。
 */

export type RelationAnchor = 'start' | 'end';
export type RelationSide = 'start' | 'end';

/** 一行上的一个关系：于 predecessorId 的 anchor，偏移 offsetDays 天 */
export interface RelationRef {
  predecessorId: string;
  anchor: RelationAnchor;
  offsetDays: number;
}

/** 存在数据库里的关系：taskId 的 side 那一行挂着这个关系 */
export interface TaskRelation extends RelationRef {
  taskId: string;
  side: RelationSide;
}

export type EndMode = 'date' | 'relations' | 'after_start';

export interface ScheduleSpec {
  /** 开始是固定日期时的日期（有开始关系时不用） */
  startOn: CalendarDate | null;
  startRelations: readonly RelationRef[];
  endMode: EndMode;
  /** 结束是固定日期时的日期（截止时间所在的日期） */
  endOn: CalendarDate | null;
  endAfterDays: number | null;
  endRelations: readonly RelationRef[];
}

export interface ScheduledDates {
  start: CalendarDate | null;
  end: CalendarDate | null;
}

/** 某任务在关系里的日期：开始没有时按结束日期（里程碑） */
export function anchorDate(dates: ScheduledDates, anchor: RelationAnchor): CalendarDate | null {
  return anchor === 'start' ? (dates.start ?? dates.end) : dates.end;
}

/** 一行上所有关系里最晚的日期 */
export function resolveRelations(
  refs: readonly RelationRef[],
  datesOf: (taskId: string) => ScheduledDates | undefined,
): CalendarDate | null {
  return latestDate(
    refs.map((ref) => {
      const dates = datesOf(ref.predecessorId);
      const base = dates ? anchorDate(dates, ref.anchor) : null;
      return base === null ? null : addDays(base, ref.offsetDays);
    }),
  );
}

/** 按两行逻辑算出开始和结束 */
export function computeScheduleDates(
  spec: ScheduleSpec,
  datesOf: (taskId: string) => ScheduledDates | undefined,
): ScheduledDates {
  const start =
    spec.startRelations.length > 0 ? resolveRelations(spec.startRelations, datesOf) : spec.startOn;
  let end: CalendarDate | null;
  if (spec.endMode === 'after_start') {
    end = start !== null && spec.endAfterDays !== null ? addDays(start, spec.endAfterDays) : null;
  } else if (spec.endMode === 'relations') {
    end = resolveRelations(spec.endRelations, datesOf);
  } else {
    end = spec.endOn;
  }
  return { start, end };
}

/** 从存下来的关系和字段还原两行逻辑 */
export function scheduleSpecOf(
  task: { startOn: CalendarDate | null; endAfterDays: number | null },
  endOn: CalendarDate | null,
  relations: readonly TaskRelation[],
): ScheduleSpec {
  const pick = (side: RelationSide) =>
    relations
      .filter((r) => r.side === side)
      .map(({ predecessorId, anchor, offsetDays }) => ({ predecessorId, anchor, offsetDays }));
  const endRelations = pick('end');
  return {
    startOn: task.startOn,
    startRelations: pick('start'),
    endMode:
      task.endAfterDays !== null ? 'after_start' : endRelations.length > 0 ? 'relations' : 'date',
    endOn,
    endAfterDays: task.endAfterDays,
    endRelations,
  };
}

/** 开始和结束是同一天：里程碑；只有结束、没有开始的也画成里程碑 */
export function isMilestone(dates: ScheduledDates): boolean {
  return dates.end !== null && (dates.start === null || dates.start === dates.end);
}
