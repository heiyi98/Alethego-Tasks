import {
  buildRecurrenceRule,
  parseRecurrenceRule,
  validateRecurrenceSpec,
  type RecurrenceRuleSpec,
  type RecurrenceSpecError,
  type Task,
} from '@alethego/core';

import { fromDateTimeLocalValue, toDateTimeLocalValue } from './format';

/** 循环开关与重复规则的表单状态，以及它与任务字段之间的转换（不依赖 React，便于单元测试） */

export interface RecurrenceFormState {
  enabled: boolean;
  /** 可编辑的规则；为 null 时表示使用 customRule（超出界面可编辑范围的规则） */
  spec: RecurrenceRuleSpec | null;
  customRule: string | null;
  /** 起始时间，datetime-local 格式 */
  dtstart: string;
}

export function recurrenceFormFromTask(task: Task): RecurrenceFormState {
  const spec = task.recurrenceRule ? parseRecurrenceRule(task.recurrenceRule) : null;
  return {
    enabled: task.recurrenceRule !== null,
    spec,
    customRule: task.recurrenceRule && !spec ? task.recurrenceRule : null,
    dtstart: toDateTimeLocalValue(task.recurrenceDtstart),
  };
}

const SPEC_ERRORS: Record<RecurrenceSpecError, string> = {
  no_weekday: '请至少选择一个星期几',
  bad_interval: '重复间隔需为正整数',
  bad_count: '重复次数需为正整数',
};

export type RecurrencePatch =
  | { ok: true; recurrenceRule: string | null; recurrenceDtstart?: Date }
  | { ok: false; error: string };

/** 表单状态 → 任务字段；关闭开关只清空规则（起始时间保留，历史记录不受影响） */
export function recurrencePatch(state: RecurrenceFormState): RecurrencePatch {
  if (!state.enabled) return { ok: true, recurrenceRule: null };
  const dtstart = fromDateTimeLocalValue(state.dtstart);
  if (!dtstart) return { ok: false, error: '请设置循环的开始时间' };
  if (!state.spec) {
    return state.customRule
      ? { ok: true, recurrenceRule: state.customRule, recurrenceDtstart: dtstart }
      : { ok: false, error: '请设置重复规则' };
  }
  const error = validateRecurrenceSpec(state.spec);
  if (error) return { ok: false, error: SPEC_ERRORS[error] };
  return { ok: true, recurrenceRule: buildRecurrenceRule(state.spec), recurrenceDtstart: dtstart };
}
