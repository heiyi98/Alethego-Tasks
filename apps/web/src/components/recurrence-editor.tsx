'use client';

import {
  LAST_DAY_OF_MONTH,
  WEEKDAYS,
  buildRecurrenceRule,
  defaultRecurrenceSpec,
  describeRecurrence,
  monthDayOf,
  parseRecurrenceRule,
  resolveRepresentativeInstance,
  untilFromLocalDate,
  validateRecurrenceSpec,
  weekdayName,
  weekdayOf,
  type RecurrenceEnd,
  type RecurrenceFrequency,
  type RecurrenceOccurrence,
  type RecurrenceRuleSpec,
  type RecurrenceSpecError,
  type Task,
} from '@alethego/core';

import {
  formatFullDateTime,
  fromDateTimeLocalValue,
  fromDateValue,
  toDateTimeLocalValue,
  toDateValue,
} from '@/lib/format';

/**
 * 循环开关与重复规则编辑。循环不是独立的任务类型，只是任务上的一个开关：
 * 打开后设置 RRULE + 起始时间，关闭后任务恢复为普通任务，已产生的历史记录保留。
 */

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
  no_month_day: '请至少选择一个日期',
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

/** 打开开关时的默认起始时间：任务的截止时间，没有则为今天 09:00 */
function defaultDtstart(task: Task): Date {
  if (task.deadlineAt) return task.deadlineAt;
  const date = new Date();
  date.setHours(9, 0, 0, 0);
  return date;
}

const FREQUENCY_UNITS: Record<RecurrenceFrequency, string> = {
  daily: '天',
  weekly: '周',
  monthly: '个月',
  yearly: '年',
};

const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

export function RecurrenceEditor({
  task,
  value,
  onChange,
  records,
  now,
  timeZone,
}: {
  task: Task;
  value: RecurrenceFormState;
  onChange: (next: RecurrenceFormState) => void;
  /** 该任务已有的实例记录，用于预览"当前实例" */
  records: readonly RecurrenceOccurrence[];
  now: Date;
  timeZone: string;
}) {
  const dtstartDate = fromDateTimeLocalValue(value.dtstart);

  function toggle(enabled: boolean) {
    if (!enabled) {
      onChange({ ...value, enabled: false });
      return;
    }
    const dtstart = dtstartDate ?? defaultDtstart(task);
    onChange({
      enabled: true,
      dtstart: toDateTimeLocalValue(dtstart),
      spec: value.spec ?? (value.customRule ? null : defaultRecurrenceSpec(dtstart, timeZone)),
      customRule: value.customRule,
    });
  }

  function updateSpec(patch: Partial<RecurrenceRuleSpec>) {
    if (!value.spec) return;
    const spec = { ...value.spec, ...patch };
    // 仅在切换频率时：若尚未选择具体的星期 / 日期，按起始时间补一个。
    // 用户手动清空时不自动补回，交给校验提示。
    const frequencyChanged =
      patch.frequency !== undefined && patch.frequency !== value.spec.frequency;
    if (frequencyChanged && dtstartDate) {
      if (spec.frequency === 'weekly' && spec.weekdays.length === 0) {
        spec.weekdays = [weekdayOf(dtstartDate, timeZone)];
      }
      if (spec.frequency === 'monthly' && spec.monthDays.length === 0) {
        spec.monthDays = [monthDayOf(dtstartDate, timeZone)];
      }
    }
    onChange({ ...value, spec });
  }

  function setEnd(kind: RecurrenceEnd['kind']) {
    const base = dtstartDate ?? now;
    const end: RecurrenceEnd =
      kind === 'never'
        ? { kind }
        : kind === 'count'
          ? { kind, count: 10 }
          : {
              kind,
              until: untilFromLocalDate(new Date(base.getTime() + 30 * 86_400_000), timeZone),
            };
    updateSpec({ end });
  }

  const patch = recurrencePatch(value);
  const preview =
    value.enabled && patch.ok && patch.recurrenceRule && patch.recurrenceDtstart
      ? resolveRepresentativeInstance(
          { rule: patch.recurrenceRule, dtstart: patch.recurrenceDtstart },
          records,
          { now, timeZone },
        )
      : null;

  return (
    <fieldset className="field recurrence" aria-label="重复">
      <label className="switch">
        <input
          type="checkbox"
          role="switch"
          checked={value.enabled}
          onChange={(event) => toggle(event.target.checked)}
        />
        <span className="switch-track" aria-hidden />
        重复
      </label>

      {value.enabled && (
        <div className="recurrence-body" role="group" aria-label="重复规则">
          {value.spec ? (
            <>
              <div className="field-inline">
                <span>每</span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  aria-label="重复间隔"
                  className="input-narrow"
                  value={value.spec.interval}
                  onChange={(event) => updateSpec({ interval: Number(event.target.value) })}
                />
                <select
                  aria-label="重复频率"
                  value={value.spec.frequency}
                  onChange={(event) =>
                    updateSpec({ frequency: event.target.value as RecurrenceFrequency })
                  }
                >
                  {(Object.keys(FREQUENCY_UNITS) as RecurrenceFrequency[]).map((f) => (
                    <option key={f} value={f}>
                      {FREQUENCY_UNITS[f]}
                    </option>
                  ))}
                </select>
              </div>

              {value.spec.frequency === 'weekly' && (
                <div className="chip-row" role="group" aria-label="星期">
                  {WEEKDAYS.map((day) => {
                    const selected = value.spec!.weekdays.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        className="chip chip-square"
                        aria-pressed={selected}
                        aria-label={`周${weekdayName(day)}`}
                        onClick={() =>
                          updateSpec({
                            weekdays: selected
                              ? value.spec!.weekdays.filter((d) => d !== day)
                              : [...value.spec!.weekdays, day],
                          })
                        }
                      >
                        {weekdayName(day)}
                      </button>
                    );
                  })}
                </div>
              )}

              {value.spec.frequency === 'monthly' && (
                <div className="month-days" role="group" aria-label="日期">
                  {[...MONTH_DAYS, LAST_DAY_OF_MONTH].map((day) => {
                    const selected = value.spec!.monthDays.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        className={`chip chip-square${day === LAST_DAY_OF_MONTH ? ' month-last' : ''}`}
                        aria-pressed={selected}
                        aria-label={day === LAST_DAY_OF_MONTH ? '最后一天' : `${day}号`}
                        onClick={() =>
                          updateSpec({
                            monthDays: selected
                              ? value.spec!.monthDays.filter((d) => d !== day)
                              : [...value.spec!.monthDays, day],
                          })
                        }
                      >
                        {day === LAST_DAY_OF_MONTH ? '最后一天' : day}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <p className="muted">
              自定义规则 <code>{value.customRule}</code>，无法在此编辑。
              <button
                type="button"
                className="button-link"
                onClick={() =>
                  onChange({
                    ...value,
                    customRule: null,
                    spec: defaultRecurrenceSpec(dtstartDate ?? defaultDtstart(task), timeZone),
                  })
                }
              >
                改为可编辑的规则
              </button>
            </p>
          )}

          <label className="field-inline">
            <span>开始时间</span>
            <input
              type="datetime-local"
              aria-label="开始时间"
              value={value.dtstart}
              onChange={(event) => onChange({ ...value, dtstart: event.target.value })}
            />
          </label>

          {value.spec && (
            <div className="field-inline">
              <span>结束</span>
              <select
                aria-label="结束方式"
                value={value.spec.end.kind}
                onChange={(event) => setEnd(event.target.value as RecurrenceEnd['kind'])}
              >
                <option value="never">永不结束</option>
                <option value="count">重复一定次数</option>
                <option value="until">截止到某天</option>
              </select>
              {value.spec.end.kind === 'count' && (
                <>
                  <input
                    type="number"
                    min={1}
                    aria-label="重复次数"
                    className="input-narrow"
                    value={value.spec.end.count}
                    onChange={(event) =>
                      updateSpec({ end: { kind: 'count', count: Number(event.target.value) } })
                    }
                  />
                  <span>次</span>
                </>
              )}
              {value.spec.end.kind === 'until' && (
                <input
                  type="date"
                  aria-label="截止日期"
                  value={toDateValue(value.spec.end.until)}
                  onChange={(event) => {
                    const date = fromDateValue(event.target.value);
                    if (date) {
                      updateSpec({
                        end: { kind: 'until', until: untilFromLocalDate(date, timeZone) },
                      });
                    }
                  }}
                />
              )}
            </div>
          )}

          <p className="recurrence-summary" data-testid="recurrence-summary">
            {patch.ok ? (
              <>
                {value.spec ? describeRecurrence(value.spec, timeZone) : '自定义规则'}
                {' · '}
                {preview
                  ? `当前实例：${formatFullDateTime(preview.occurrenceAt, timeZone)}`
                  : '按此规则已没有后续实例'}
              </>
            ) : (
              <span className="field-error">{patch.error}</span>
            )}
          </p>
        </div>
      )}
    </fieldset>
  );
}
