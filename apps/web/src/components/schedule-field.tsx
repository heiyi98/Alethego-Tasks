'use client';

import type { CalendarDate, RelationAnchor } from '@alethego/core';
import { useState, type ReactNode } from 'react';

import { CategoryDot } from './category-dot';
import { IconButton, PlusIcon, XIcon } from './icons';
import { formatDay, formatOffset } from '@/lib/format';
import type { RelationScope } from '@/lib/schedule';
import type { RelationDraft, ScheduleFormValue, TaskFormValue } from '@/lib/task-form';

/**
 * 有"任务关系"的任务在详情里的两行：开始、结束。每行分上下两层：
 * - 第一层选条件的类型：开始是 日期 / 关系；结束是 日期 / 关系 / 开始后
 * - 第二层是内容：日期输入框、关系（"于〔某任务〕的〔开始 / 结束〕"）或"N 天"
 * 填了关系的那一行日期由系统算出（只显示，不能手填），显示在第一层的最后。
 * 一行可以挂多个关系，取最晚；默认只显示一个条件，它旁边的"＋"再加一个。
 * 每个关系最后有偏移：默认"当天"，点开是 − / + 步进器，也可以直接输入。
 * 选关系对象时先选项目（组里）或分类（个人），默认是当前所在的那个，再选任务。
 */
export function ScheduleField({
  value,
  deadline,
  deadlineTime,
  onChange,
  scopes,
  defaultScopeId,
  computed,
  readOnly,
}: {
  value: ScheduleFormValue;
  deadline: string;
  deadlineTime: string;
  onChange: (patch: Partial<TaskFormValue>) => void;
  scopes: readonly RelationScope[];
  defaultScopeId: string;
  /** 按现在的两行逻辑算出的日期 */
  computed: { start: CalendarDate | null; end: CalendarDate | null };
  readOnly: boolean;
}) {
  const set = (patch: Partial<ScheduleFormValue>) => onChange({ schedule: { ...value, ...patch } });

  return (
    <fieldset className="editor-fieldset schedule-field" disabled={readOnly}>
      <div className="schedule-side" role="group" aria-label="开始">
        <div className="schedule-row">
          <span className="schedule-label">开始</span>
          <ModeSwitch
            label="开始的方式"
            value={value.startMode}
            options={[
              ['date', '日期'],
              ['relations', '关系'],
            ]}
            onChange={(startMode) => set({ startMode })}
          />
          {value.startMode === 'relations' && <Computed date={computed.start} label="算出的开始" />}
        </div>
        <div className="schedule-content">
          {value.startMode === 'date' ? (
            <DateInput
              label="开始日期"
              value={value.startOn}
              onChange={(startOn) => set({ startOn })}
            />
          ) : (
            <RelationList
              side="开始"
              relations={value.startRelations}
              onChange={(startRelations) => set({ startRelations })}
              scopes={scopes}
              defaultScopeId={defaultScopeId}
            />
          )}
        </div>
      </div>

      <div className="schedule-side" role="group" aria-label="结束">
        <div className="schedule-row">
          <span className="schedule-label">结束</span>
          <ModeSwitch
            label="结束的方式"
            value={value.endMode}
            options={[
              ['date', '日期'],
              ['relations', '关系'],
              ['after_start', '开始后'],
            ]}
            onChange={(endMode) => set({ endMode })}
          />
          {value.endMode !== 'date' && <Computed date={computed.end} label="算出的结束" />}
        </div>
        <div className="schedule-content">
          {value.endMode === 'date' && (
            <>
              <DateInput
                label="结束日期"
                value={deadline}
                onChange={(d) => onChange(d ? { deadline: d } : { deadline: '', deadlineTime: '' })}
              />
              {deadline && (
                <input
                  type="time"
                  aria-label="结束时刻"
                  className={`date-input time-input${deadlineTime ? '' : ' date-input-empty'}`}
                  value={deadlineTime}
                  onChange={(event) => onChange({ deadlineTime: event.target.value })}
                />
              )}
            </>
          )}
          {value.endMode === 'after_start' && (
            <>
              <input
                type="number"
                min={0}
                max={3650}
                aria-label="开始后的天数"
                className="schedule-days"
                value={value.endAfterDays}
                onChange={(event) =>
                  set({
                    endAfterDays: Math.max(0, Math.min(3650, Number(event.target.value) || 0)),
                  })
                }
              />
              <span className="schedule-unit">天</span>
            </>
          )}
          {value.endMode === 'relations' && (
            <RelationList
              side="结束"
              relations={value.endRelations}
              onChange={(endRelations) => set({ endRelations })}
              scopes={scopes}
              defaultScopeId={defaultScopeId}
            />
          )}
        </div>
      </div>
    </fieldset>
  );
}

function ModeSwitch<T extends string>({
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
    <div className="mini-segmented schedule-mode" role="radiogroup" aria-label={label}>
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

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <input
        type="date"
        aria-label={label}
        className={`date-input${value ? '' : ' date-input-empty'}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value && (
        <IconButton
          label={`清除${label}`}
          className="icon-button-small"
          onClick={() => onChange('')}
        >
          <XIcon size={14} />
        </IconButton>
      )}
    </>
  );
}

function Computed({ date, label }: { date: CalendarDate | null; label: string }) {
  return (
    <span className="schedule-computed" aria-label={label}>
      {date ? formatDay(date) : '—'}
    </span>
  );
}

function RelationList({
  side,
  relations,
  onChange,
  scopes,
  defaultScopeId,
}: {
  side: '开始' | '结束';
  relations: readonly RelationDraft[];
  onChange: (next: RelationDraft[]) => void;
  scopes: readonly RelationScope[];
  defaultScopeId: string;
}) {
  const blank = (): RelationDraft => ({
    predecessorId: '',
    anchor: 'end',
    offsetDays: 0,
    scopeId: defaultScopeId,
  });
  // 一个关系都没有时也显示一个空条件（选了对象才算数）
  const rows = relations.length > 0 ? relations : [blank()];
  const update = (index: number, patch: Partial<RelationDraft>) =>
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  return (
    <ul className="relation-list" aria-label={`${side}的关系`}>
      {rows.map((relation, index) => (
        <RelationRow
          key={index}
          relation={relation}
          scopes={scopes}
          onChange={(patch) => update(index, patch)}
          onRemove={
            rows.length > 1 || relation.predecessorId
              ? () => onChange(rows.filter((_, i) => i !== index))
              : undefined
          }
          extra={
            index === rows.length - 1 && (
              <IconButton
                label={`添加${side}的关系`}
                className="icon-button-small relation-add"
                onClick={() => onChange([...rows, blank()])}
              >
                <PlusIcon size={16} />
              </IconButton>
            )
          }
        />
      ))}
    </ul>
  );
}

function RelationRow({
  relation,
  scopes,
  onChange,
  onRemove,
  extra,
}: {
  relation: RelationDraft;
  scopes: readonly RelationScope[];
  onChange: (patch: Partial<RelationDraft>) => void;
  /** 没有时不显示"去掉"（只剩一个空条件） */
  onRemove?: () => void;
  /** 行尾的"＋" */
  extra?: ReactNode;
}) {
  const [stepper, setStepper] = useState(false);
  const scope = scopes.find((s) => s.id === relation.scopeId) ?? scopes[0];
  const tasks = scope?.tasks ?? [];
  return (
    <li className="relation-row" data-predecessor={relation.predecessorId || undefined}>
      {scope && <CategoryDot color={scope.color} />}
      <select
        aria-label="项目或分类"
        className="relation-select relation-scope"
        value={scope?.id ?? ''}
        onChange={(event) => onChange({ scopeId: event.target.value, predecessorId: '' })}
      >
        {scopes.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <span className="relation-word">于</span>
      <select
        aria-label="关系对象"
        className={`relation-select${relation.predecessorId ? '' : ' raci-quick-empty'}`}
        value={relation.predecessorId}
        onChange={(event) => onChange({ predecessorId: event.target.value })}
      >
        <option value="">—</option>
        {tasks.map((t) => (
          <option key={t.id} value={t.id}>
            {t.title}
          </option>
        ))}
      </select>
      <span className="relation-word">的</span>
      <select
        aria-label="开始还是结束"
        className="relation-select relation-anchor"
        value={relation.anchor}
        onChange={(event) => onChange({ anchor: event.target.value as RelationAnchor })}
      >
        <option value="start">开始</option>
        <option value="end">结束</option>
      </select>
      <button
        type="button"
        className="relation-offset"
        aria-label="偏移"
        aria-expanded={stepper}
        onClick={() => setStepper(!stepper)}
      >
        {formatOffset(relation.offsetDays)}
      </button>
      {stepper && (
        <span className="relation-stepper" role="group" aria-label="偏移天数">
          <IconButton
            label="前一天"
            className="icon-button-small"
            onClick={() => onChange({ offsetDays: relation.offsetDays - 1 })}
          >
            −
          </IconButton>
          <input
            type="number"
            aria-label="偏移的天数"
            value={relation.offsetDays}
            onChange={(event) =>
              onChange({
                offsetDays: Math.max(
                  -3650,
                  Math.min(3650, Math.trunc(Number(event.target.value) || 0)),
                ),
              })
            }
          />
          <IconButton
            label="后一天"
            className="icon-button-small"
            onClick={() => onChange({ offsetDays: relation.offsetDays + 1 })}
          >
            +
          </IconButton>
        </span>
      )}
      {onRemove && (
        <IconButton label="去掉这个关系" className="icon-button-small" onClick={onRemove}>
          <XIcon size={14} />
        </IconButton>
      )}
      {extra}
    </li>
  );
}
