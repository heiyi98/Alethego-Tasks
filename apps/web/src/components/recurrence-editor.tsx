'use client';

import {
  ORDINALS,
  RECURRENCE_PERIODS,
  WEEKDAYS,
  resolveRepresentativeInstance,
  type MonthDay,
  type Ordinal,
  type RecurrenceEnd,
  type RecurrenceOccurrence,
  type RecurrencePeriod,
  type Weekday,
} from '@alethego/core';
import { useState } from 'react';

import { DatePicker } from './date-picker';
import { ChevronDownIcon, IconButton, PlusIcon, XIcon } from './icons';
import { messages } from '@/i18n';
import { formatDate, toDateValue } from '@/lib/format';
import {
  defaultRecurrenceForm,
  recurrencePatch,
  type RecurrenceFormState,
} from '@/lib/recurrence-form';
import type { TaskFormValue } from '@/lib/task-form';

/**
 * 循环开关与重复规则。循环不是独立的任务类型，只是任务上的一个开关：打开后开关右边同一行是
 * "日、周、月、年"四个选项，下面是这一种的内容；关闭后任务恢复为普通任务，已产生的历史记录保留。
 * 开始日期就是第二行的截止日期。规则下方嵌着历史：过去最近两次（最近的在上），勾上 = 已完成。
 */

const t = messages.recurrence;
const DAYS_1_31 = Array.from({ length: 31 }, (_, i) => i + 1);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const WEEKS = Array.from({ length: 53 }, (_, i) => i + 1);

/** 历史默认显示的行数；展开后的行数 */
const HISTORY_ROWS = 2;
const HISTORY_ROWS_EXPANDED = 5;

const toggleIn = <T,>(list: readonly T[], item: T): T[] =>
  list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

export function RecurrenceEditor({
  value,
  start,
  onChange,
  records,
  onToggleRecord,
  historyProgress,
  now,
  timeZone,
}: {
  value: RecurrenceFormState;
  /** 开始日期（第二行的日期）；空 = 还没选 */
  start: string;
  /** 打开开关时还没选日期：第二行一并设为今天 */
  onChange: (next: RecurrenceFormState, patch?: Partial<TaskFormValue>) => void;
  /** 该任务已有的实例记录（历史） */
  records: readonly RecurrenceOccurrence[];
  /** 切换某次实例的完成状态；不传时不显示历史（例如新建时） */
  onToggleRecord?: (record: RecurrenceOccurrence, completed: boolean) => void;
  /** 历史里每一次的子任务进度（例如 2/5）；那一次没有子任务时为 null */
  historyProgress?: (record: RecurrenceOccurrence) => string | null;
  now: Date;
  timeZone: string;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const set = (patch: Partial<RecurrenceFormState>) => onChange({ ...value, ...patch });

  function toggle(enabled: boolean) {
    if (!enabled) {
      onChange({ ...value, enabled: false });
      return;
    }
    // 打开时各种标尺的默认值都落在开始日期那一天；还没选日期时开始日期是今天
    const date = start || toDateValue(now);
    onChange(
      { ...defaultRecurrenceForm(date, true), period: value.period },
      start ? undefined : { deadline: date },
    );
  }

  // 历史：当前代表实例之前的记录（包括提前完成的），最近的在上
  const patch = recurrencePatch(value);
  const current =
    value.enabled && patch.ok && patch.recurrenceRule && start
      ? resolveRepresentativeInstance({ rule: patch.recurrenceRule, start }, records, {
          now,
          timeZone,
        })
      : null;
  const today = toDateValue(now);
  const history = [...records]
    .filter((r) => (current ? r.occurrenceDate < current.occurrenceDate : r.occurrenceDate < today))
    .sort((a, b) => (a.occurrenceDate < b.occurrenceDate ? 1 : -1));

  return (
    <fieldset className="field recurrence" aria-label="重复">
      <div className="recurrence-head">
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
          <Segmented
            label="重复周期"
            value={value.period}
            options={RECURRENCE_PERIODS.map((p) => [p, t.periods[p]] as const)}
            onChange={(period: RecurrencePeriod) => set({ period })}
          />
        )}
      </div>

      {value.enabled && (
        <div className="recurrence-body" role="group" aria-label="重复规则">
          <div className="field-inline">
            <span>{t.every.before}</span>
            <input
              type="number"
              min={1}
              max={999}
              aria-label="重复间隔"
              className="input-narrow"
              value={value.interval}
              onChange={(event) => set({ interval: Number(event.target.value) })}
            />
            <span>{t.every.after[value.period]}</span>
          </div>

          {value.period === 'week' && (
            <WeekdayChips
              label="星期"
              value={value.weekdays}
              onChange={(weekdays) => set({ weekdays })}
            />
          )}

          {value.period === 'month' && (
            <>
              <Segmented
                label="按月的方式"
                value={value.monthBy}
                options={[
                  ['day', t.monthModes.day],
                  ['weekday', t.monthModes.weekday],
                ]}
                onChange={(monthBy) => set({ monthBy })}
              />
              {value.monthBy === 'day' ? (
                <div className="day-grid" role="group" aria-label="日子">
                  {[...DAYS_1_31, 'last' as const].map((day: MonthDay) => (
                    <button
                      key={day}
                      type="button"
                      className={`day-cell${day === 'last' ? ' day-cell-wide' : ''}`}
                      aria-pressed={value.monthDays.includes(day)}
                      aria-label={day === 'last' ? t.lastDay : `${day}日`}
                      onClick={() => set({ monthDays: toggleIn(value.monthDays, day) })}
                    >
                      {day === 'last' ? t.lastDay : day}
                    </button>
                  ))}
                </div>
              ) : (
                <ConditionRows
                  rows={value.monthRows}
                  onChange={(monthRows) => set({ monthRows })}
                  newRow={() => ({ ordinal: 1 as Ordinal, weekdays: [] as Weekday[] })}
                  render={(row, update) => (
                    <OrdinalSelect
                      value={row.ordinal}
                      onChange={(ordinal) => update({ ordinal })}
                    />
                  )}
                />
              )}
            </>
          )}

          {value.period === 'year' && (
            <>
              <Segmented
                label="按年的方式"
                value={value.yearBy}
                options={[
                  ['monthDay', t.yearModes.monthDay],
                  ['monthWeekday', t.yearModes.monthWeekday],
                  ['weekNumber', t.yearModes.weekNumber],
                ]}
                onChange={(yearBy) => set({ yearBy })}
              />
              {value.yearBy === 'monthDay' && (
                <div className="year-days">
                  {MONTHS.map((month) => {
                    const days = value.yearDays[month] ?? [];
                    return (
                      <div
                        key={month}
                        className="year-month"
                        role="group"
                        aria-label={t.months[month - 1]}
                      >
                        <span className="year-month-name">{t.months[month - 1]}</span>
                        <div className="day-grid day-grid-compact">
                          {DAYS_1_31.map((day) => (
                            <button
                              key={day}
                              type="button"
                              className="day-cell"
                              aria-pressed={days.includes(day)}
                              aria-label={`${month}月${day}日`}
                              onClick={() =>
                                set({
                                  yearDays: { ...value.yearDays, [month]: toggleIn(days, day) },
                                })
                              }
                            >
                              {day}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {value.yearBy === 'monthWeekday' && (
                <ConditionRows
                  rows={value.yearMonthRows}
                  onChange={(yearMonthRows) => set({ yearMonthRows })}
                  newRow={() => ({ month: 1, ordinal: 1 as Ordinal, weekdays: [] as Weekday[] })}
                  render={(row, update) => (
                    <>
                      <select
                        aria-label="月份"
                        value={row.month}
                        onChange={(event) => update({ month: Number(event.target.value) })}
                      >
                        {MONTHS.map((m) => (
                          <option key={m} value={m}>
                            {t.months[m - 1]}
                          </option>
                        ))}
                      </select>
                      <OrdinalSelect
                        value={row.ordinal}
                        onChange={(ordinal) => update({ ordinal })}
                      />
                    </>
                  )}
                />
              )}
              {value.yearBy === 'weekNumber' && (
                <ConditionRows
                  rows={value.yearWeekRows}
                  onChange={(yearWeekRows) => set({ yearWeekRows })}
                  newRow={() => ({ week: 1, weekdays: [] as Weekday[] })}
                  render={(row, update) => (
                    <select
                      aria-label="第几周"
                      value={row.week}
                      onChange={(event) => update({ week: Number(event.target.value) })}
                    >
                      {WEEKS.map((w) => (
                        <option key={w} value={w}>
                          {t.weekNumber(w)}
                        </option>
                      ))}
                    </select>
                  )}
                />
              )}
            </>
          )}

          <EndField value={value.end} start={start || today} onChange={(end) => set({ end })} />

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
                  const when = formatDate(record.occurrenceDate, today);
                  const progress = historyProgress?.(record);
                  return (
                    <li
                      key={record.id}
                      // 纯外观：已完成的删除线、变灰；没做的按"已错过"显示（日期标红）
                      className={`history-row-inline ${record.status === 'completed' ? 'task-completed' : 'task-missed'}`}
                    >
                      <input
                        type="checkbox"
                        className="task-check"
                        aria-label={`完成：${when}`}
                        checked={record.status === 'completed'}
                        onChange={(event) => onToggleRecord(record, event.target.checked)}
                      />
                      <span className="task-title task-deadline">{when}</span>
                      {progress && <span className="history-progress">{progress}</span>}
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

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="mini-segmented" role="radiogroup" aria-label={label}>
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          aria-pressed={value === key}
          onClick={() => onChange(key)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** 一 二 三 四 五 六 日，可多选 */
function WeekdayChips({
  label,
  value,
  onChange,
}: {
  label: string;
  value: readonly Weekday[];
  onChange: (next: Weekday[]) => void;
}) {
  return (
    <div className="chip-row" role="group" aria-label={label}>
      {WEEKDAYS.map((day) => (
        <button
          key={day}
          type="button"
          className="chip chip-square"
          aria-pressed={value.includes(day)}
          aria-label={`周${t.weekdays[day]}`}
          onClick={() => onChange(toggleIn(value, day))}
        >
          {t.weekdays[day]}
        </button>
      ))}
    </div>
  );
}

function OrdinalSelect({
  value,
  onChange,
}: {
  value: Ordinal;
  onChange: (value: Ordinal) => void;
}) {
  return (
    <select
      aria-label="第几个"
      value={value}
      onChange={(event) => onChange(Number(event.target.value) as Ordinal)}
    >
      {ORDINALS.map((o) => (
        <option key={o} value={o}>
          {t.ordinals[o]}
        </option>
      ))}
    </select>
  );
}

/** 一行一个条件：前面的选择（第几个 / 月份 / 第几周）+ 星期多选；"＋"再加一行，多于一行时可以删 */
function ConditionRows<R extends { weekdays: Weekday[] }>({
  rows,
  onChange,
  newRow,
  render,
}: {
  rows: readonly R[];
  onChange: (rows: R[]) => void;
  newRow: () => R;
  render: (row: R, update: (patch: Partial<R>) => void) => React.ReactNode;
}) {
  const update = (index: number, patch: Partial<R>) =>
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  return (
    <div className="condition-rows">
      {rows.map((row, index) => (
        <div
          key={index}
          className="condition-row"
          role="group"
          aria-label={`第 ${index + 1} 行条件`}
        >
          {render(row, (patch) => update(index, patch))}
          <WeekdayChips
            label="星期"
            value={row.weekdays}
            onChange={(weekdays) => update(index, { weekdays } as Partial<R>)}
          />
          {rows.length > 1 && (
            <IconButton
              label={`删除第 ${index + 1} 行条件`}
              className="icon-button-small"
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
            >
              <XIcon size={14} />
            </IconButton>
          )}
        </div>
      ))}
      <IconButton
        label={t.addRow}
        className="add-person"
        onClick={() => onChange([...rows, newRow()])}
      >
        <PlusIcon size={16} />
      </IconButton>
    </div>
  );
}

/** 结束：永不 / 重复一定次数 / 截止到某天 */
function EndField({
  value,
  start,
  onChange,
}: {
  value: RecurrenceEnd;
  start: string;
  onChange: (end: RecurrenceEnd) => void;
}) {
  const setKind = (kind: RecurrenceEnd['kind']) => {
    if (kind === 'never') onChange({ kind });
    else if (kind === 'count') onChange({ kind, count: 10 });
    else {
      const [y, m, d] = start.split('-').map(Number) as [number, number, number];
      onChange({ kind, until: toDateValue(new Date(y, m - 1, d + 30)) });
    }
  };
  return (
    <div className="field-inline">
      <span>结束</span>
      <select
        aria-label="结束方式"
        value={value.kind}
        onChange={(event) => setKind(event.target.value as RecurrenceEnd['kind'])}
      >
        <option value="never">永不结束</option>
        <option value="count">重复一定次数</option>
        <option value="until">截止到某天</option>
      </select>
      {value.kind === 'count' && (
        <>
          <input
            type="number"
            min={1}
            aria-label="重复次数"
            className="input-narrow"
            value={value.count}
            onChange={(event) => onChange({ kind: 'count', count: Number(event.target.value) })}
          />
          <span>次</span>
        </>
      )}
      {value.kind === 'until' && (
        <DatePicker
          label="结束日期"
          value={value.until}
          clearable={false}
          onChange={(until) => until && onChange({ kind: 'until', until })}
        />
      )}
    </div>
  );
}
