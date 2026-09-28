'use client';

import type { Category, RecurrenceOccurrence } from '@alethego/core';
import type { ReactNode } from 'react';

import { CategoryDot } from './category-dot';
import {
  CalendarIcon,
  ChevronDownIcon,
  FieldIcon,
  FlagIcon,
  IconButton,
  LocationIcon,
  PersonAddIcon,
  PersonIcon,
  RepeatIcon,
  TagIcon,
  TextIcon,
  TrashIcon,
  XIcon,
} from './icons';
import { RecurrenceEditor } from './recurrence-editor';
import { IMPORTANCE_LEVELS, fromDateValue } from '@/lib/format';
import { newRowKey, type FormErrors, type TaskFormValue } from '@/lib/task-form';

/**
 * 任务面板的表单（新建与编辑共用）。字段以图标为标签；任务内容本身是文字。
 * 本组件只负责展示与收集输入，保存逻辑由外层（新建 / 编辑）控制器负责。
 */

/** 快速添加栏下方与展开面板中共用的一行：重要性 + 截止日期 + 展开 / 收起三角 */
export function QuickOptionsRow({
  value,
  onChange,
  expanded,
  onToggle,
  toggleLabel,
}: {
  value: Pick<TaskFormValue, 'importanceLevel' | 'deadline' | 'recurrence'>;
  onChange: (patch: Partial<TaskFormValue>) => void;
  expanded: boolean;
  onToggle: () => void;
  toggleLabel: string;
}) {
  return (
    <div className="quick-options">
      <div className="option" role="group" aria-label="重要性">
        <FieldIcon label="重要性">
          <FlagIcon size={16} />
        </FieldIcon>
        <div className="mini-segmented">
          {IMPORTANCE_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={value.importanceLevel === level}
              aria-label={`重要性 ${level}`}
              title={`重要性 ${level}`}
              onClick={() => onChange({ importanceLevel: level })}
            >
              {level}
            </button>
          ))}
        </div>
      </div>

      {!value.recurrence.enabled && (
        <div className="option">
          <FieldIcon label="截止日期">
            <CalendarIcon size={16} />
          </FieldIcon>
          <input
            type="date"
            aria-label="截止日期"
            title="截止日期"
            className={`date-input${value.deadline ? '' : ' date-input-empty'}`}
            value={value.deadline}
            onChange={(event) => onChange({ deadline: event.target.value })}
          />
          {value.deadline && (
            <IconButton
              label="清除截止日期"
              className="icon-button-small"
              onClick={() => onChange({ deadline: '' })}
            >
              <XIcon size={14} />
            </IconButton>
          )}
        </div>
      )}

      <IconButton
        label={toggleLabel}
        className={`expand-toggle${expanded ? ' expand-toggle-open' : ''}`}
        aria-expanded={expanded}
        data-panel-anchor
        onClick={onToggle}
      >
        <ChevronDownIcon size={16} />
      </IconButton>
    </div>
  );
}

export function TaskEditor({
  mode,
  value,
  onChange,
  errors,
  categories,
  records,
  now,
  timeZone,
  fallbackStart,
  actions,
  onToggle,
  onRemovePerson,
  saveState,
}: {
  mode: 'create' | 'edit';
  value: TaskFormValue;
  onChange: (patch: Partial<TaskFormValue>) => void;
  errors: FormErrors;
  categories: readonly Category[];
  records: readonly RecurrenceOccurrence[];
  now: Date;
  timeZone: string;
  /** 打开循环开关时默认的起始时间 */
  fallbackStart: Date | null;
  /** 标题右侧的操作图标（新建：对勾 / 叉；编辑：完成 / 历史 / 删除） */
  actions: ReactNode;
  /** 收起面板（三角） */
  onToggle: () => void;
  /** 删除第 index 个人物（由控制器负责撤销提示） */
  onRemovePerson: (index: number) => void;
  /** 自动保存状态，写在 data-save-state 上 */
  saveState?: string;
}) {
  const toggleCategory = (id: string) =>
    onChange({
      categoryIds: value.categoryIds.includes(id)
        ? value.categoryIds.filter((c) => c !== id)
        : [...value.categoryIds, id],
    });

  const setPerson = (key: string, patch: { name?: string; relation?: string }) =>
    onChange({ people: value.people.map((p) => (p.key === key ? { ...p, ...patch } : p)) });

  return (
    <div
      className="task-editor"
      data-mode={mode}
      data-save-state={saveState ?? 'idle'}
      aria-label={mode === 'create' ? '新建任务' : '编辑任务'}
      role="form"
    >
      <div className="editor-title-row">
        <input
          className="editor-title"
          aria-label="标题"
          placeholder={mode === 'create' ? '新任务' : '标题'}
          value={value.title}
          autoFocus={mode === 'create'}
          onChange={(event) => onChange({ title: event.target.value })}
        />
        <div className="editor-actions">{actions}</div>
      </div>
      {errors.title && <p className="field-error">{errors.title}</p>}

      <QuickOptionsRow
        value={value}
        onChange={onChange}
        expanded
        onToggle={onToggle}
        toggleLabel="收起"
      />

      <div className="editor-field">
        <FieldIcon label="描述">
          <TextIcon />
        </FieldIcon>
        <textarea
          aria-label="描述"
          placeholder="描述"
          rows={2}
          value={value.description}
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </div>

      <div className="editor-field" role="group" aria-label="分类">
        <FieldIcon label="分类">
          <TagIcon />
        </FieldIcon>
        {categories.length === 0 ? (
          <span className="muted">—</span>
        ) : (
          <div className="chip-row">
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                className="chip chip-compact"
                aria-pressed={value.categoryIds.includes(category.id)}
                onClick={() => toggleCategory(category.id)}
              >
                <CategoryDot color={category.color} />
                {category.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="editor-field editor-field-top">
        <FieldIcon label="重复">
          <RepeatIcon />
        </FieldIcon>
        <div className="editor-field-body">
          <RecurrenceEditor
            fallbackStart={fallbackStart ?? fromDateValue(value.deadline)}
            value={value.recurrence}
            onChange={(recurrence) => onChange({ recurrence })}
            records={records}
            now={now}
            timeZone={timeZone}
          />
          {errors.recurrence && <p className="field-error">{errors.recurrence}</p>}
        </div>
      </div>

      <div className="editor-field" role="group" aria-label="地点">
        <FieldIcon label="地点">
          <LocationIcon />
        </FieldIcon>
        <div className="field-pair">
          <input
            aria-label="地点名称"
            placeholder="地点"
            value={value.location.name}
            onChange={(event) =>
              onChange({ location: { ...value.location, name: event.target.value } })
            }
          />
          <input
            aria-label="地址"
            placeholder="地址"
            value={value.location.address}
            onChange={(event) =>
              onChange({ location: { ...value.location, address: event.target.value } })
            }
          />
        </div>
      </div>

      <div className="editor-field editor-field-top" role="group" aria-label="人物">
        <FieldIcon label="人物">
          <PersonIcon />
        </FieldIcon>
        <div className="editor-field-body">
          {value.people.length > 0 && (
            <ul className="people-list">
              {value.people.map((person, index) => (
                <li key={person.key} className="person-row">
                  <input
                    aria-label={`第 ${index + 1} 个人物的姓名`}
                    placeholder="姓名"
                    value={person.name}
                    onChange={(event) => setPerson(person.key, { name: event.target.value })}
                  />
                  <input
                    aria-label={`第 ${index + 1} 个人物的关系`}
                    placeholder="关系"
                    value={person.relation}
                    onChange={(event) => setPerson(person.key, { relation: event.target.value })}
                  />
                  <IconButton
                    label={`删除第 ${index + 1} 个人物`}
                    onClick={() => onRemovePerson(index)}
                  >
                    <TrashIcon size={16} />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
          <IconButton
            label="添加人物"
            className="add-person"
            onClick={() =>
              onChange({ people: [...value.people, { key: newRowKey(), name: '', relation: '' }] })
            }
          >
            <PersonAddIcon />
          </IconButton>
          {errors.people && <p className="field-error">{errors.people}</p>}
        </div>
      </div>
    </div>
  );
}
