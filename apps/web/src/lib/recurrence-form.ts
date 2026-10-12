import {
  buildRecurrenceRule,
  isEmptyPattern,
  normalizePattern,
  parseRecurrenceRule,
  validateRecurrenceSpec,
  type MonthDay,
  type Ordinal,
  type RecurrencePattern,
  type RecurrencePeriod,
  type RecurrenceRuleSpec,
  type RecurrenceSpecError,
  type Task,
  type Weekday,
} from '@alethego/core';

/**
 * 循环开关与重复规则的表单状态，以及它与任务字段之间的转换（不依赖 React，便于单元测试）。
 * - 打开循环后不默认选中任何模式；选了模式之后，里面的选项全部空着（间隔默认 1）。
 * - 每种周期 / 标尺各存一份，切换时不丢已经选好的内容；保存时只用当前选中的那一种。
 * - 什么都没选（没选模式，或选了模式但一个位置都没选）就保存，等同于没有开启循环。
 * - 没有结束条件：循环任务一直重复，唯一的结束方式是关掉循环。
 * 开始日期不在这里：就是第二行的截止日期。
 */

/** 条件行（"第［ ］个""［ ］月""第［ ］周"）：没选的是 null，这一行不算 */
export interface OrdinalRow {
  ordinal: Ordinal | null;
  weekdays: Weekday[];
}
export interface MonthOrdinalRow extends OrdinalRow {
  month: number | null;
}
export interface WeekNumberRow {
  week: number | null;
  weekdays: Weekday[];
}

export interface RecurrenceFormState {
  enabled: boolean;
  /** 日 / 周 / 月 / 年；null = 还没选 */
  period: RecurrencePeriod | null;
  interval: number;
  /** 周：星期几 */
  weekdays: Weekday[];
  /** 月：按日 / 按周；null = 还没选 */
  monthBy: 'day' | 'weekday' | null;
  monthDays: MonthDay[];
  monthRows: OrdinalRow[];
  /** 年：月日 / 月周 / 年周；null = 还没选 */
  yearBy: 'monthDay' | 'monthWeekday' | 'weekNumber' | null;
  yearDays: Record<number, number[]>;
  yearMonthRows: MonthOrdinalRow[];
  yearWeekRows: WeekNumberRow[];
  /**
   * 已保存的循环任务在这一次编辑里先关掉又打开：等于"关掉循环重新设"，第二行的日期可以重新选，
   * 保存时先关掉原来的循环（当前这一次变成普通任务的那一步），再按新的规则和开始日期开始
   */
  restarted: boolean;
}

export const emptyOrdinalRow = (): OrdinalRow => ({ ordinal: null, weekdays: [] });
export const emptyMonthOrdinalRow = (): MonthOrdinalRow => ({
  month: null,
  ordinal: null,
  weekdays: [],
});
export const emptyWeekNumberRow = (): WeekNumberRow => ({ week: null, weekdays: [] });

/** 什么都没选的表单 */
export function defaultRecurrenceForm(enabled = false): RecurrenceFormState {
  return {
    enabled,
    period: null,
    interval: 1,
    weekdays: [],
    monthBy: null,
    monthDays: [],
    monthRows: [emptyOrdinalRow()],
    yearBy: null,
    yearDays: {},
    yearMonthRows: [emptyMonthOrdinalRow()],
    yearWeekRows: [emptyWeekNumberRow()],
    restarted: false,
  };
}

/** 选好了的条件行（前面的选择和至少一个星期都有） */
const ordinalRows = (rows: readonly OrdinalRow[]) =>
  rows.flatMap((r) =>
    r.ordinal !== null && r.weekdays.length > 0
      ? [{ ordinal: r.ordinal, weekdays: r.weekdays }]
      : [],
  );

/**
 * 表单里当前选中的那一种 → 规则结构。没开、没选模式、选了模式但一个位置都没选：null（等同于没有开启循环）。
 */
export function specFromForm(state: RecurrenceFormState): RecurrenceRuleSpec | null {
  if (!state.enabled || state.period === null) return null;
  let pattern: RecurrencePattern;
  switch (state.period) {
    case 'day':
      pattern = { period: 'day' };
      break;
    case 'week':
      pattern = { period: 'week', weekdays: state.weekdays };
      break;
    case 'month':
      if (state.monthBy === null) return null;
      pattern =
        state.monthBy === 'day'
          ? { period: 'month', by: 'day', days: state.monthDays }
          : { period: 'month', by: 'weekday', rows: ordinalRows(state.monthRows) };
      break;
    case 'year':
      if (state.yearBy === null) return null;
      if (state.yearBy === 'monthDay') {
        pattern = { period: 'year', by: 'monthDay', days: state.yearDays };
      } else if (state.yearBy === 'monthWeekday') {
        pattern = {
          period: 'year',
          by: 'monthWeekday',
          rows: state.yearMonthRows.flatMap((r) =>
            r.month !== null && r.ordinal !== null && r.weekdays.length > 0
              ? [{ month: r.month, ordinal: r.ordinal, weekdays: r.weekdays }]
              : [],
          ),
        };
      } else {
        pattern = {
          period: 'year',
          by: 'weekNumber',
          rows: state.yearWeekRows.flatMap((r) =>
            r.week !== null && r.weekdays.length > 0
              ? [{ week: r.week, weekdays: r.weekdays }]
              : [],
          ),
        };
      }
      break;
  }
  if (isEmptyPattern(pattern)) return null;
  return { pattern, interval: state.interval };
}

/** 表单保存出来是不是循环任务 */
export function isRecurring(state: RecurrenceFormState): boolean {
  return specFromForm(state) !== null;
}

/** 已保存的规则 → 表单（没用到的标尺空着） */
export function recurrenceFormFromRule(rule: string | null): RecurrenceFormState {
  const base = defaultRecurrenceForm(rule !== null);
  const spec = rule ? parseRecurrenceRule(rule) : null;
  if (!spec) return base;
  const form: RecurrenceFormState = {
    ...base,
    period: spec.pattern.period,
    interval: spec.interval,
  };
  const pattern = spec.pattern;
  if (pattern.period === 'week') form.weekdays = pattern.weekdays;
  if (pattern.period === 'month') {
    form.monthBy = pattern.by;
    if (pattern.by === 'day') form.monthDays = pattern.days;
    else form.monthRows = pattern.rows;
  }
  if (pattern.period === 'year') {
    form.yearBy = pattern.by;
    if (pattern.by === 'monthDay') form.yearDays = pattern.days;
    else if (pattern.by === 'monthWeekday') form.yearMonthRows = pattern.rows;
    else form.yearWeekRows = pattern.rows;
  }
  return form;
}

export function recurrenceFormFromTask(task: Pick<Task, 'recurrenceRule'>): RecurrenceFormState {
  return recurrenceFormFromRule(task.recurrenceRule);
}

const SPEC_ERRORS: Record<RecurrenceSpecError, string> = {
  bad_interval: '重复间隔需为正整数',
};

export type RecurrencePatch =
  { ok: true; recurrenceRule: string | null } | { ok: false; error: string };

/** 表单状态 → 规则；没开或什么都没选 = 没有规则（历史记录不受影响） */
export function recurrencePatch(state: RecurrenceFormState): RecurrencePatch {
  const spec = specFromForm(state);
  if (!spec) return { ok: true, recurrenceRule: null };
  const error = validateRecurrenceSpec(spec);
  if (error) return { ok: false, error: SPEC_ERRORS[error] };
  return { ok: true, recurrenceRule: buildRecurrenceRule(spec) };
}

/** 两份表单保存出来的规则是否相同（没选中的标尺、没选完的条件行不算） */
export function sameRecurrence(a: RecurrenceFormState, b: RecurrenceFormState): boolean {
  if (a.restarted !== b.restarted) return false;
  const key = (state: RecurrenceFormState) => {
    const spec = specFromForm(state);
    return spec ? JSON.stringify({ ...spec, pattern: normalizePattern(spec.pattern) }) : '';
  };
  return key(a) === key(b);
}
