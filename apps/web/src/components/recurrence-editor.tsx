'use client';

import {
  WEEKDAYS,
  defaultRecurrenceSpec,
  resolveRepresentativeInstance,
  untilFromLocalDate,
  weekdayName,
  weekdayOf,
  type RecurrenceEnd,
  type RecurrenceFrequency,
  type RecurrenceOccurrence,
  type RecurrenceRuleSpec,
} from '@alethego/core';
import { useState } from 'react';

import { ChevronDownIcon, IconButton } from './icons';
import {
  formatFullDateTime,
  fromDateTimeLocalValue,
  fromDateValue,
  toDateTimeLocalValue,
  toDateValue,
} from '@/lib/format';
import { recurrencePatch, type RecurrenceFormState } from '@/lib/recurrence-form';

/**
 * 循环开关与重复规则编辑（每 N 天 / 每 N 周）。循环不是独立的任务类型，只是任务上的一个开关：
 * 打开后设置 RRULE + 起始时间，关闭后任务恢复为普通任务，已产生的历史记录保留。
 * 规则下方嵌着历史：过去最近两次实例（最近的在上），勾上 = 已完成，可展开查看更早的记录。
 */

/** 打开开关时的默认起始时间：任务的截止时间（若有），否则为今天 09:00 */
function defaultDtstart(fallback: Date | null): Date {
  if (fallback) return fallback;
  const date = new Date();
  date.setHours(9, 0, 0, 0);
  return date;
}

const FREQUENCY_UNITS: Record<RecurrenceFrequency, string> = {
  daily: '天',
  weekly: '周',
};

/** 历史默认显示的行数；展开后的行数 */
const HISTORY_ROWS = 2;
const HISTORY_ROWS_EXPANDED = 5;

export function RecurrenceEditor({
  fallbackStart,
  value,
  onChange,
  records,
  onToggleRecord,
  now,
  timeZone,
}: {
  /** 打开开关时默认的起始时间（通常是任务的截止时间）；没有则取今天 09:00 */
  fallbackStart: Date | null;
  value: RecurrenceFormState;
  onChange: (next: RecurrenceFormState) => void;
  /** 该任务已有的实例记录（历史） */
  records: readonly RecurrenceOccurrence[];
  /** 切换某次实例的完成状态；不传时不显示历史（例如新建时） */
  onToggleRecord?: (record: RecurrenceOccurrence, completed: boolean) => void;
  now: Date;
  timeZone: string;
}) {
  const dtstartDate = fromDateTimeLocalValue(value.dtstart);
  const [historyOpen, setHistoryOpen] = useState(false);

  function toggle(enabled: boolean) {
    if (!enabled) {
      onChange({ ...value, enabled: false });
      return;
    }
    const dtstart = dtstartDate ?? defaultDtstart(fallbackStart);
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
    // 仅在切换频率时：若尚未选择具体的星期，按起始时间补一个。
    // 用户手动清空时不自动补回，交给校验提示。
    const frequencyChanged =
      patch.frequency !== undefined && patch.frequency !== value.spec.frequency;
    if (frequencyChanged && dtstartDate) {
      if (spec.frequency === 'weekly' && spec.weekdays.length === 0) {
        spec.weekdays = [weekdayOf(dtstartDate, timeZone)];
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

  // 历史：当前代表实例之前的实例记录（包括提前完成的），最近的在上
  const patch = recurrencePatch(value);
  const current =
    value.enabled && patch.ok && patch.recurrenceRule && patch.recurrenceDtstart
      ? resolveRepresentativeInstance(
          { rule: patch.recurrenceRule, dtstart: patch.recurrenceDtstart },
          records,
          { now, timeZone },
        )
      : null;
  const history = [...records]
    .filter((r) =>
      current
        ? r.occurrenceDate.getTime() < current.occurrenceAt.getTime()
        : r.occurrenceDate.getTime() <= now.getTime(),
    )
    .sort((a, b) => b.occurrenceDate.getTime() - a.occurrenceDate.getTime());

  return (
    <fieldset className="field recurrence" aria-label="重复">
      <label className="switch">
        <input
          type="checkbox"
          role="switch"
          aria-label="重复"
          checked={value.enabled}
          onChange={(event) => toggle(event.target.checked)}
        />
        <span className="switch-track" aria-hidden />
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
                    spec: defaultRecurrenceSpec(
                      dtstartDate ?? defaultDtstart(fallbackStart),
                      timeZone,
                    ),
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
                  aria-label="结束日期"
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

          {onToggleRecord && history.length > 0 && (
            <div
              className={`recurrence-history${historyOpen ? ' recurrence-history-open' : ''}`}
              role="group"
              aria-label="历史"
            >
              <ul
                className="history-rows"
                style={{
                  maxHeight: `calc(var(--history-row-h) * ${historyOpen ? HISTORY_ROWS_EXPANDED : HISTORY_ROWS})`,
                }}
              >
                {(historyOpen ? history : history.slice(0, HISTORY_ROWS)).map((record) => {
                  const when = formatFullDateTime(record.occurrenceDate, timeZone);
                  return (
                    <li
                      key={record.id}
                      // 纯外观：已完成的记录沿用任务行现有的"已完成"样式（删除线、变灰）
                      className={`history-row-inline${record.status === 'completed' ? ' task-completed' : ''}`}
                    >
                      <input
                        type="checkbox"
                        className="task-check"
                        aria-label={`完成：${when}`}
                        checked={record.status === 'completed'}
                        onChange={(event) => onToggleRecord(record, event.target.checked)}
                      />
                      <span className="task-title">{when}</span>
                    </li>
                  );
                })}
              </ul>
              {history.length > HISTORY_ROWS && (
                <IconButton
                  label={historyOpen ? '收起历史' : '展开历史'}
                  className={`history-toggle${historyOpen ? ' history-toggle-open' : ''}`}
                  aria-expanded={historyOpen}
                  onClick={() => setHistoryOpen((open) => !open)}
                >
                  <ChevronDownIcon size={16} />
                </IconButton>
              )}
            </div>
          )}
        </div>
      )}
    </fieldset>
  );
}
