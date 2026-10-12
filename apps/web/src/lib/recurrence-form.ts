import {
  buildRecurrenceRule,
  gregorian,
  normalizePattern,
  parseRecurrenceRule,
  validateRecurrenceSpec,
  weekdayCode,
  type MonthDay,
  type MonthOrdinalWeekdays,
  type Ordinal,
  type OrdinalWeekdays,
  type RecurrenceEnd,
  type RecurrencePattern,
  type RecurrencePeriod,
  type RecurrenceRuleSpec,
  type RecurrenceSpecError,
  type Task,
  type WeekNumberWeekdays,
  type Weekday,
} from '@alethego/core';

/**
 * 循环开关与重复规则的表单状态，以及它与任务字段之间的转换（不依赖 React，便于单元测试）。
 * 每种周期 / 标尺各存一份，切换时不丢已经选好的内容；保存时只用当前选中的那一种。
 * 开始日期不在这里：就是第二行的截止日期。
 */
export interface RecurrenceFormState {
  enabled: boolean;
  period: RecurrencePeriod;
  interval: number;
  /** 周：星期几 */
  weekdays: Weekday[];
  /** 月：按日 / 按周 */
  monthBy: 'day' | 'weekday';
  monthDays: MonthDay[];
  monthRows: OrdinalWeekdays[];
  /** 年：月日 / 月周 / 年周 */
  yearBy: 'monthDay' | 'monthWeekday' | 'weekNumber';
  yearDays: Record<number, number[]>;
  yearMonthRows: MonthOrdinalWeekdays[];
  yearWeekRows: WeekNumberWeekdays[];
  end: RecurrenceEnd;
}

/** 某天是这个月的第几个星期几（第 5 个算"最后一个"） */
function ordinalOf(date: string): Ordinal {
  const nth = Math.ceil(gregorian.dayOf(date) / 7);
  return nth >= 5 ? -1 : (nth as Ordinal);
}

/** 打开循环时各种标尺的默认值：都落在开始日期那一天上 */
export function defaultRecurrenceForm(start: string, enabled = false): RecurrenceFormState {
  const weekday = weekdayCode(gregorian.weekdayOf(start));
  const month = gregorian.monthOf(start);
  const day = gregorian.dayOf(start);
  return {
    enabled,
    period: 'week',
    interval: 1,
    weekdays: [weekday],
    monthBy: 'day',
    monthDays: [day],
    monthRows: [{ ordinal: ordinalOf(start), weekdays: [weekday] }],
    yearBy: 'monthDay',
    yearDays: { [month]: [day] },
    yearMonthRows: [{ month, ordinal: ordinalOf(start), weekdays: [weekday] }],
    yearWeekRows: [{ week: gregorian.weekOf(start), weekdays: [weekday] }],
    end: { kind: 'never' },
  };
}

/** 表单里当前选中的那一种 → 规则结构 */
export function specFromForm(state: RecurrenceFormState): RecurrenceRuleSpec {
  let pattern: RecurrencePattern;
  switch (state.period) {
    case 'day':
      pattern = { period: 'day' };
      break;
    case 'week':
      pattern = { period: 'week', weekdays: state.weekdays };
      break;
    case 'month':
      pattern =
        state.monthBy === 'day'
          ? { period: 'month', by: 'day', days: state.monthDays }
          : { period: 'month', by: 'weekday', rows: state.monthRows };
      break;
    case 'year':
      pattern =
        state.yearBy === 'monthDay'
          ? { period: 'year', by: 'monthDay', days: state.yearDays }
          : state.yearBy === 'monthWeekday'
            ? { period: 'year', by: 'monthWeekday', rows: state.yearMonthRows }
            : { period: 'year', by: 'weekNumber', rows: state.yearWeekRows };
      break;
  }
  return { pattern, interval: state.interval, end: state.end };
}

/** 已保存的规则 → 表单（没用到的标尺按开始日期给默认值） */
export function recurrenceFormFromRule(rule: string | null, start: string): RecurrenceFormState {
  const base = defaultRecurrenceForm(start, rule !== null);
  const spec = rule ? parseRecurrenceRule(rule) : null;
  if (!spec) return base;
  const form: RecurrenceFormState = {
    ...base,
    period: spec.pattern.period,
    interval: spec.interval,
    end: spec.end,
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

export function recurrenceFormFromTask(task: Task, start: string): RecurrenceFormState {
  return recurrenceFormFromRule(task.recurrenceRule, start);
}

const SPEC_ERRORS: Record<RecurrenceSpecError, string> = {
  no_weekday: '请至少选择一个星期几',
  no_day: '请至少选择一天',
  no_condition: '请至少设一个条件',
  bad_interval: '重复间隔需为正整数',
  bad_count: '重复次数需为正整数',
};

export type RecurrencePatch =
  { ok: true; recurrenceRule: string | null } | { ok: false; error: string };

/** 表单状态 → 规则；关闭开关只清空规则（开始日期保留，历史记录不受影响） */
export function recurrencePatch(state: RecurrenceFormState): RecurrencePatch {
  if (!state.enabled) return { ok: true, recurrenceRule: null };
  const spec = specFromForm(state);
  const error = validateRecurrenceSpec(spec);
  if (error) return { ok: false, error: SPEC_ERRORS[error] };
  return { ok: true, recurrenceRule: buildRecurrenceRule(spec) };
}

/** 两份表单保存出来的规则是否相同（没选中的标尺不算） */
export function sameRecurrence(a: RecurrenceFormState, b: RecurrenceFormState): boolean {
  if (a.enabled !== b.enabled) return false;
  if (!a.enabled) return true;
  const key = (state: RecurrenceFormState) => {
    const spec = specFromForm(state);
    return JSON.stringify({ ...spec, pattern: normalizePattern(spec.pattern) });
  };
  return key(a) === key(b);
}
