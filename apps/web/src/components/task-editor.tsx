'use client';

import {
  RACI_ROLES,
  raciAllowsContacts,
  type CalendarDate,
  type Category,
  type ProjectContact,
  type ProjectMember,
  type RaciRole,
  type RecurrenceOccurrence,
} from '@alethego/core';
import type { AssignmentDraft } from '@alethego/data';
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
import { ScheduleField } from './schedule-field';
import { messages } from '@/i18n';
import { IMPORTANCE_LEVELS, fromDateValue, toDateValue } from '@/lib/format';
import type { RelationScope } from '@/lib/schedule';
import { newRowKey, type FormErrors, type TaskFormValue } from '@/lib/task-form';

/** RACI 里能选的人：项目成员 */
type RaciPerson = Pick<ProjectMember, 'userId' | 'nickname'>;

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
  readOnly = false,
  leading,
  assignees,
  hideDeadline = false,
}: {
  value: Pick<TaskFormValue, 'importanceLevel' | 'deadline' | 'deadlineTime' | 'recurrence'> &
    Partial<Pick<TaskFormValue, 'raci'>>;
  onChange: (patch: Partial<TaskFormValue>) => void;
  expanded: boolean;
  onToggle: () => void;
  toggleLabel: string;
  /** 放在三角左边的操作图标（桌面上的新建面板：标星、放弃） */
  actions?: ReactNode;
  /** 组任务：不显示重要性 */
  inGroup?: boolean;
  /** 只能看不能改（管理组里的组员）：三角照常可用 */
  readOnly?: boolean;
  /** 有"任务关系"的任务：截止日期挪到下面"结束"那一行 */
  hideDeadline?: boolean;
  /** 放在这一行最前面的选项（组页面的快速添加：选项目） */
  leading?: ReactNode;
  /** 开了任务分配的项目的快速添加：时间旁边选执行人（R）和负责人（A），各选一个（展开后在 RACI 里可以选多个） */
  assignees?: readonly RaciPerson[];
}) {
  // 时刻输入框：已选时刻时一直显示；否则点时钟图标后显示（日期被清空 / 创建后草稿重置时收回时钟图标）
  const [timeOpen, setTimeOpen] = useState(false);
  const showTime = value.deadlineTime !== '' || (timeOpen && value.deadline !== '');
  return (
    <div className="quick-options">
      <fieldset className="editor-fieldset quick-options-fields" disabled={readOnly}>
        {leading}
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

        {!value.recurrence.enabled && !hideDeadline && (
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
        {assignees &&
          (['R', 'A'] as const).map((role) => {
            const raci = value.raci ?? [];
            const current = raci.find((a) => a.role === role && a.userId)?.userId ?? '';
            return (
              <div
                key={role}
                className="option raci-quick"
                role="group"
                aria-label={messages.raciRoles[role]}
              >
                <span className="raci-quick-label" aria-hidden>
                  {role}
                </span>
                <select
                  aria-label={messages.raciRoles[role]}
                  className={`raci-quick-select${current ? '' : ' raci-quick-empty'}`}
                  value={current}
                  onChange={(event) =>
                    onChange({
                      raci: [
                        ...raci.filter((a) => a.role !== role),
                        ...(event.target.value
                          ? [{ role, userId: event.target.value, contactId: null }]
                          : []),
                      ],
                    })
                  }
                >
                  {/* 执行人必须选，没选时不能创建；负责人默认是自己 */}
                  {role === 'R' && <option value="">—</option>}
                  {assignees.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.nickname}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
      </fieldset>
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
  readOnly = false,
}: {
  value: string;
  onChange: (title: string) => void;
  actions: ReactNode;
  className?: string;
  placeholder?: string;
  readOnly?: boolean;
}) {
  return (
    <div className={`editor-title-row ${className}`}>
      <input
        className="editor-title"
        aria-label="标题"
        placeholder={placeholder}
        value={value}
        readOnly={readOnly}
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
  raci,
  readOnly = false,
  records,
  onToggleRecord,
  now,
  timeZone,
  fallbackStart,
  onToggle,
  onRemovePerson,
  titleRow,
  optionsActions,
  optionsLeading,
  schedule,
}: {
  value: TaskFormValue;
  onChange: (patch: Partial<TaskFormValue>) => void;
  errors: FormErrors;
  categories: readonly Category[];
  /** 组任务：不显示重要性和分类（收藏由外层决定是否显示） */
  inGroup?: boolean;
  /** 开了任务分配的项目：可选的项目成员与只有名字的人；editable = 能不能改 */
  raci?: { members: readonly RaciPerson[]; contacts: readonly ProjectContact[]; editable: boolean };
  /** 只能看不能改（不是项目管理员） */
  readOnly?: boolean;
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
  /** 常用选项一行最前面的选项（组页面新建：选项目） */
  optionsLeading?: ReactNode;
  /** 有"任务关系"的任务：开始 / 结束两行（关系对象的候选和算出的日期） */
  schedule?: {
    scopes: readonly RelationScope[];
    defaultScopeId: string;
    computed: { start: CalendarDate | null; end: CalendarDate | null };
  };
  /** 删除第 index 个人物（由控制器负责撤销提示） */
  onRemovePerson: (index: number) => void;
}) {
  const toggleCategory = (id: string) =>
    onChange({
      categoryIds: value.categoryIds.includes(id)
        ? value.categoryIds.filter((c) => c !== id)
        : [...value.categoryIds, id],
    });

  // 循环任务没有两行逻辑
  const showSchedule = Boolean(value.schedule && schedule && !value.recurrence.enabled);

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
        readOnly={readOnly}
        leading={optionsLeading}
        hideDeadline={showSchedule}
      />

      {showSchedule && value.schedule && schedule && (
        <ScheduleField
          value={value.schedule}
          deadline={value.deadline}
          deadlineTime={value.deadlineTime}
          onChange={onChange}
          scopes={schedule.scopes}
          defaultScopeId={schedule.defaultScopeId}
          computed={schedule.computed}
          readOnly={readOnly}
        />
      )}

      {raci && (
        <RaciField
          value={value.raci}
          onChange={(next) => onChange({ raci: next })}
          members={raci.members}
          contacts={raci.contacts}
          editable={raci.editable}
        />
      )}

      <fieldset className="editor-fieldset" disabled={readOnly}>
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
                onChange({
                  people: [...value.people, { key: newRowKey(), name: '', relation: '' }],
                })
              }
            >
              <PersonAddIcon />
            </IconButton>
            {errors.people && <p className="field-error">{errors.people}</p>}
          </div>
        </div>
      </fieldset>
    </div>
  );
}

/** 执行人（R）和负责人（A）至少要有一个 */
const requiredRole = (role: RaciRole) => role === 'R' || role === 'A';

/** 人：组内成员（u:id）或只有名字的人（c:id） */
const keyOf = (a: Pick<AssignmentDraft, 'userId' | 'contactId'>) =>
  a.userId ? `u:${a.userId}` : `c:${a.contactId}`;

/**
 * RACI：每个字母一行，列出已选的人；能改时每个人后面有 ✕，最后是添加的下拉框。
 * R、A 只能选项目成员；C、I 还可以选只有名字的人。每个字母不限人数。
 */
function RaciField({
  value,
  onChange,
  members,
  contacts,
  editable,
}: {
  value: readonly AssignmentDraft[];
  onChange: (next: AssignmentDraft[]) => void;
  members: readonly RaciPerson[];
  contacts: readonly ProjectContact[];
  editable: boolean;
}) {
  const nameOf = (a: AssignmentDraft) =>
    a.userId
      ? (members.find((m) => m.userId === a.userId)?.nickname ?? '')
      : (contacts.find((c) => c.id === a.contactId)?.name ?? '');

  return (
    <div className="editor-field editor-field-top raci-field" role="group" aria-label="RACI">
      <div className="raci-rows">
        {RACI_ROLES.map((role) => {
          const chosen = value.filter((a) => a.role === role);
          const chosenKeys = new Set(chosen.map(keyOf));
          const options = [
            ...members.map((m) => ({ key: `u:${m.userId}`, name: m.nickname })),
            ...(raciAllowsContacts(role)
              ? contacts.map((c) => ({ key: `c:${c.id}`, name: c.name }))
              : []),
          ].filter((o) => !chosenKeys.has(o.key));
          return (
            <div key={role} className="raci-row" role="group" aria-label={messages.raciRoles[role]}>
              <span className="raci-letter" aria-hidden>
                {messages.raciRoles[role]}
              </span>
              <div className="chip-row">
                {chosen.map((a) => (
                  <span key={keyOf(a)} className="chip chip-compact raci-chip">
                    {nameOf(a)}
                    {/* 执行人和负责人不能删到一个都不剩 */}
                    {editable && !(requiredRole(role) && chosen.length === 1) && (
                      <IconButton
                        label={`从${messages.raciRoles[role]}中去掉「${nameOf(a)}」`}
                        className="icon-button-small"
                        onClick={() =>
                          onChange(value.filter((x) => !(x.role === role && keyOf(x) === keyOf(a))))
                        }
                      >
                        <XIcon size={12} />
                      </IconButton>
                    )}
                  </span>
                ))}
                {!editable && chosen.length === 0 && <span className="muted">—</span>}
                {editable && options.length > 0 && (
                  <select
                    className="raci-add"
                    aria-label={`添加${messages.raciRoles[role]}`}
                    value=""
                    onChange={(event) => {
                      const key = event.target.value;
                      if (!key) return;
                      const [kind, id] = [key.slice(0, 1), key.slice(2)];
                      onChange([
                        ...value,
                        {
                          role: role as RaciRole,
                          userId: kind === 'u' ? id : null,
                          contactId: kind === 'c' ? id : null,
                        },
                      ]);
                    }}
                  >
                    <option value="">＋</option>
                    {options.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
