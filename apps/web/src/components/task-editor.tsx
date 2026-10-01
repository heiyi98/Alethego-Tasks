'use client';

import type { Category, RecurrenceOccurrence } from '@alethego/core';
import { useState, type ReactNode } from 'react';

import { CategoryDot } from './category-dot';
import {
  CalendarIcon,
  ChevronDownIcon,
  ClockIcon,
  FieldIcon,
  FlagIcon,
  IconButton,
  LocationIcon,
  PersonAddIcon,
  PersonIcon,
  RepeatIcon,
  StarIcon,
  TagIcon,
  TextIcon,
  TrashIcon,
  XIcon,
} from './icons';
import { RecurrenceEditor } from './recurrence-editor';
import { IMPORTANCE_LEVELS, fromDateValue, toDateValue } from '@/lib/format';
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
  actions,
  inGroup = false,
}: {
  value: Pick<TaskFormValue, 'importanceLevel' | 'deadline' | 'deadlineTime' | 'recurrence'>;
  onChange: (patch: Partial<TaskFormValue>) => void;
  expanded: boolean;
  onToggle: () => void;
  toggleLabel: string;
  /** 放在三角左边的操作图标（桌面上的新建面板：标星、放弃） */
  actions?: ReactNode;
  /** 组任务：不显示重要性 */
  inGroup?: boolean;
}) {
  // 时刻输入框：已选时刻时一直显示；否则点时钟图标后显示（日期被清空 / 创建后草稿重置时收回时钟图标）
  const [timeOpen, setTimeOpen] = useState(false);
  const showTime = value.deadlineTime !== '' || (timeOpen && value.deadline !== '');
  return (
    <div className="quick-options">
      {!inGroup && (
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
                onClick={() => onChange({ importanceLevel: level })}
              >
                {level}
              </button>
            ))}
          </div>
        </div>
      )}

      {!value.recurrence.enabled && (
        <div className="option">
          <FieldIcon label="截止日期">
            <CalendarIcon size={16} />
          </FieldIcon>
          <input
            type="date"
            aria-label="截止日期"
            className={`date-input${value.deadline ? '' : ' date-input-empty'}`}
            value={value.deadline}
            onChange={(event) =>
              // 清空日期时一并清空时刻
              onChange(
                event.target.value
                  ? { deadline: event.target.value }
                  : { deadline: '', deadlineTime: '' },
              )
            }
          />
          {showTime ? (
            <>
              <input
                type="time"
                aria-label="截止时刻"
                className={`date-input time-input${value.deadlineTime ? '' : ' date-input-empty'}`}
                value={value.deadlineTime}
                autoFocus={timeOpen && !value.deadlineTime}
                onChange={(event) => onChange({ deadlineTime: event.target.value })}
              />
              <IconButton
                label="清除时刻"
                className="icon-button-small"
                onClick={() => {
                  setTimeOpen(false);
                  onChange({ deadlineTime: '' });
                }}
              >
                <XIcon size={14} />
              </IconButton>
            </>
          ) : (
            <IconButton
              label="选择时刻"
              className="icon-button-small"
              onClick={() => {
                setTimeOpen(true);
                // 还没选日期时默认今天
                if (!value.deadline) onChange({ deadline: toDateValue(new Date()) });
              }}
            >
              <ClockIcon size={16} />
            </IconButton>
          )}
          {value.deadline && !showTime && (
            <IconButton
              label="清除截止日期"
              className="icon-button-small"
              onClick={() => onChange({ deadline: '', deadlineTime: '' })}
            >
              <XIcon size={14} />
            </IconButton>
          )}
        </div>
      )}

      {actions && <div className="quick-options-actions desktop-only">{actions}</div>}
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

/** 标题行：标题输入框 + 右侧操作图标 */
export function EditorTitleRow({
  value,
  onChange,
  actions,
  className = '',
  placeholder = '标题',
}: {
  value: string;
  onChange: (title: string) => void;
  actions: ReactNode;
  className?: string;
  placeholder?: string;
}) {
  return (
    <div className={`editor-title-row ${className}`}>
      <input
        className="editor-title"
        aria-label="标题"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="editor-actions">{actions}</div>
    </div>
  );
}

/** 标星切换（列表行、面板中共用） */
export function StarButton({ starred, onToggle }: { starred: boolean; onToggle: () => void }) {
  return (
    <IconButton
      label={starred ? '取消标星' : '标星'}
      className={`star-button${starred ? ' star-button-on' : ''}`}
      aria-pressed={starred}
      onClick={onToggle}
    >
      <StarIcon filled={starred} />
    </IconButton>
  );
}

export function TaskEditor({
  value,
  onChange,
  errors,
  categories,
  inGroup = false,
  records,
  onToggleRecord,
  now,
  timeZone,
  fallbackStart,
  onToggle,
  onRemovePerson,
  titleRow,
  optionsActions,
}: {
  value: TaskFormValue;
  onChange: (patch: Partial<TaskFormValue>) => void;
  errors: FormErrors;
  categories: readonly Category[];
  /** 组任务：不显示重要性和分类（收藏由外层决定是否显示） */
  inGroup?: boolean;
  records: readonly RecurrenceOccurrence[];
  /** 切换历史中某次实例的完成状态（编辑已有循环任务时） */
  onToggleRecord?: (record: RecurrenceOccurrence, completed: boolean) => void;
  now: Date;
  timeZone: string;
  /** 打开循环开关时默认的起始时间 */
  fallbackStart: Date | null;
  /**
   * 面板顶部的标题行。列表中展开时标题留在原来那一行（由外层渲染），这里只在手机底部抽屉中显示；
   * 矩阵弹出的面板没有列表行，始终显示。
   */
  titleRow?: ReactNode;
  /** 收起面板（三角） */
  onToggle: () => void;
  /** 常用选项一行里、三角左边的操作图标 */
  optionsActions?: ReactNode;
  /** 删除第 index 个人物（由控制器负责撤销提示） */
  onRemovePerson: (index: number) => void;
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
    <div className="task-editor">
      {titleRow}
      {errors.title && <p className="field-error">{errors.title}</p>}

      <QuickOptionsRow
        value={value}
        onChange={onChange}
        expanded
        onToggle={onToggle}
        toggleLabel="收起"
        actions={optionsActions}
        inGroup={inGroup}
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

      {!inGroup && (
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
      )}

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
            onToggleRecord={onToggleRecord}
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
