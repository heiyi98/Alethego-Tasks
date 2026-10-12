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
import type { ReactNode } from 'react';

import { CategoryDot } from './category-dot';
import { DatePicker } from './date-picker';
import {
  ChevronDownIcon,
  FieldIcon,
  FlagIcon,
  IconButton,
  PersonAddIcon,
  PersonIcon,
  RepeatIcon,
  StarIcon,
  TagIcon,
  TextIcon,
  TrashIcon,
  ChecklistIcon,
  PlusIcon,
  XIcon,
} from './icons';
import { PersonName } from './person-name';
import { RecurrenceEditor } from './recurrence-editor';
import { ScheduleField } from './schedule-field';
import { messages } from '@/i18n';
import { IMPORTANCE_LEVELS, importanceLabel } from '@/lib/format';
import type { RelationScope } from '@/lib/schedule';
import { newRowKey, type FormErrors, type TaskFormValue } from '@/lib/task-form';

/** RACI 里能选的人：项目成员 */
type RaciPerson = Pick<ProjectMember, 'userId' | 'nickname'>;

/**
 * 任务面板的表单（新建与编辑共用）。字段以图标为标签；任务内容本身是文字。
 * 本组件只负责展示与收集输入，保存逻辑由外层（新建 / 编辑）控制器负责。
 */

/**
 * 快速添加栏和展开面板共用的第二行：（组页面的项目选择）重要性、截止日期，右端是展开 / 收起三角。
 * 开了任务分配的项目多一个第三行：执行人、负责人。
 */
export function QuickOptionsRow({
  value,
  onChange,
  expanded,
  onToggle,
  toggleLabel,
  actions,
  readOnly = false,
  leading,
  assignees,
  computedDeadline,
  deadlineMin,
}: {
  value: Pick<TaskFormValue, 'importanceLevel' | 'deadline' | 'recurrence'> &
    Partial<Pick<TaskFormValue, 'raci'>>;
  onChange: (patch: Partial<TaskFormValue>) => void;
  expanded: boolean;
  onToggle: () => void;
  toggleLabel: string;
  /** 放在三角左边的操作图标（桌面上的新建面板：标星、放弃） */
  actions?: ReactNode;
  /** 组任务（不再影响这一行：组任务也有重要性） */
  inGroup?: boolean;
  /** 只能看不能改（管理组里的组员）：三角照常可用 */
  readOnly?: boolean;
  /** 放在这一行最前面的选项（组页面的快速添加：选项目） */
  leading?: ReactNode;
  /** 开了任务分配的项目的快速添加：第三行选执行人（R）和负责人（A），各选一个（展开后在 RACI 里可以选多个） */
  assignees?: readonly RaciPerson[];
  /**
   * 有"任务关系"的任务，结束是关系或"开始后 N 天"：截止日期由系统算出，只显示、不能点。
   * undefined = 截止日期可以选。
   */
  computedDeadline?: string | null;
  /** 截止日期不能早于这一天（循环任务改日期时） */
  deadlineMin?: string;
}) {
  const computed = computedDeadline !== undefined;
  return (
    <div className="quick-options-block">
      <div className="quick-options">
        <fieldset className="editor-fieldset quick-options-fields" disabled={readOnly}>
          {leading}
          <div className="option" role="group" aria-label="重要性">
            <FieldIcon label="重要性">
              <FlagIcon size={16} />
            </FieldIcon>
            <div className="mini-segmented importance-picker">
              {IMPORTANCE_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  aria-pressed={value.importanceLevel === level}
                  onClick={() => onChange({ importanceLevel: level })}
                >
                  {importanceLabel(level)}
                </button>
              ))}
            </div>
          </div>

          <div className="option">
            <DatePicker
              label="截止日期"
              value={computed ? (computedDeadline ?? '') : value.deadline}
              readOnly={computed || readOnly}
              // 循环任务：这一天是开始日期，不能清空
              clearable={!value.recurrence.enabled}
              min={deadlineMin}
              onChange={(deadline) => onChange({ deadline })}
            />
          </div>
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
      {assignees && (
        <fieldset className="editor-fieldset quick-options quick-options-raci" disabled={readOnly}>
          {(['R', 'A'] as const).map((role) => {
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
                  className={`raci-quick-select person-select${current ? '' : ' raci-quick-empty'}`}
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
      )}
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

/**
 * 任务详情：标题、第二行（重要性、截止日期）下面是四个固定模块，从上到下：
 * 1. 描述 + 分类（组任务没有分类，这里显示组名和项目名，只显示）
 * 2. 时间：一般任务是"循环"；有"任务关系"的任务换成开始和结束的两行逻辑（两者互斥）
 * 3. 人物（名字 + 备注）；开了任务分配的项目里换成 RACI
 * 4. 子任务
 */
export function TaskEditor({
  value,
  onChange,
  errors,
  categories,
  container,
  raci,
  readOnly = false,
  records,
  onToggleRecord,
  now,
  timeZone,
  onToggle,
  onRemovePerson,
  titleRow,
  optionsActions,
  optionsLeading,
  schedule,
  subtaskChecks,
  historyProgress,
  deadlineMin,
}: {
  value: TaskFormValue;
  onChange: (patch: Partial<TaskFormValue>) => void;
  errors: FormErrors;
  categories: readonly Category[];
  /** 组任务：第一个模块里显示组名和项目名（没有分类）；个人任务为 null */
  container?: { groupName: string; projectName: string } | null;
  /** 开了任务分配的项目：可选的项目成员与只有名字的人；editable = 能不能改 */
  raci?: { members: readonly RaciPerson[]; contacts: readonly ProjectContact[]; editable: boolean };
  /** 只能看不能改（不是项目管理员） */
  readOnly?: boolean;
  records: readonly RecurrenceOccurrence[];
  /** 切换历史中某次实例的完成状态（编辑已有循环任务时） */
  onToggleRecord?: (record: RecurrenceOccurrence, completed: boolean) => void;
  now: Date;
  timeZone: string;
  /**
   * 面板顶部的标题行。列表中展开时标题留在原来那一行（由外层渲染），这里只在手机底部抽屉中显示；
   * 矩阵弹出的面板没有列表行，始终显示。
   */
  titleRow?: ReactNode;
  /** 收起面板（三角） */
  onToggle: () => void;
  /** 第二行里、三角左边的操作图标 */
  optionsActions?: ReactNode;
  /**
   * 已保存的子任务的勾选（勾了立即生效，不经过 ✓）。不传时只编辑清单（新建时）。
   * canCheck：个人任务是自己；开了任务分配的项目里是执行人；没开的项目里是项目成员
   */
  subtaskChecks?: {
    isChecked: (subtaskId: string) => boolean;
    canCheck: boolean;
    onToggle: (subtaskId: string, checked: boolean) => void;
  };
  /** 循环任务历史里每一次的子任务进度（各次的勾选互不相关，过去各次保持原样） */
  historyProgress?: (record: RecurrenceOccurrence) => string | null;
  /** 第二行最前面的选项（组页面新建：选项目） */
  optionsLeading?: ReactNode;
  /** 有"任务关系"的任务：开始 / 结束两行（关系对象的候选和算出的日期） */
  schedule?: {
    scopes: readonly RelationScope[];
    defaultScopeId: string;
    computed: { start: CalendarDate | null; end: CalendarDate | null };
  };
  /** 第二行的日期不能早于这一天（已有的循环任务改日期：从这天起重新排以后的各次） */
  deadlineMin?: string;
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
  // 结束是关系或"开始后 N 天"：第二行的日期由系统算出，只显示
  const computedDeadline =
    showSchedule && value.schedule && value.schedule.endMode !== 'date'
      ? (schedule?.computed.end ?? null)
      : undefined;

  const setSubtask = (key: string, title: string) =>
    onChange({ subtasks: value.subtasks.map((s) => (s.key === key ? { ...s, title } : s)) });

  const setPerson = (key: string, patch: { name?: string; note?: string }) =>
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
        readOnly={readOnly}
        leading={optionsLeading}
        computedDeadline={computedDeadline}
        deadlineMin={value.recurrence.enabled ? deadlineMin : undefined}
      />

      {/* 1. 描述 + 分类（组任务：组名和项目名） */}
      <section className="editor-module" aria-label="描述">
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
          {container ? (
            <div className="editor-field" role="group" aria-label="所属">
              <FieldIcon label="所属">
                <TagIcon />
              </FieldIcon>
              <span className="editor-container">
                <span className="editor-container-group">{container.groupName}</span>
                <span className="editor-container-project">{container.projectName}</span>
              </span>
            </div>
          ) : (
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
        </fieldset>
      </section>

      {/* 2. 时间：循环，或者有"任务关系"的任务的开始 / 结束 */}
      <section className="editor-module" aria-label="时间">
        {showSchedule && value.schedule && schedule ? (
          <ScheduleField
            value={value.schedule}
            onChange={onChange}
            scopes={schedule.scopes}
            defaultScopeId={schedule.defaultScopeId}
            computed={schedule.computed}
            readOnly={readOnly}
          />
        ) : (
          <fieldset className="editor-fieldset" disabled={readOnly}>
            <div className="editor-field editor-field-top">
              <FieldIcon label="重复">
                <RepeatIcon />
              </FieldIcon>
              <div className="editor-field-body">
                <RecurrenceEditor
                  value={value.recurrence}
                  start={value.deadline}
                  onChange={(recurrence, patch) => onChange({ recurrence, ...patch })}
                  records={records}
                  onToggleRecord={onToggleRecord}
                  historyProgress={historyProgress}
                  now={now}
                  timeZone={timeZone}
                />
                {errors.recurrence && <p className="field-error">{errors.recurrence}</p>}
              </div>
            </div>
          </fieldset>
        )}
      </section>

      {/* 3. 人物；开了任务分配的项目里是 RACI */}
      <section className="editor-module" aria-label={raci ? 'RACI' : '人物'}>
        {raci ? (
          <RaciField
            value={value.raci}
            onChange={(next) => onChange({ raci: next })}
            members={raci.members}
            contacts={raci.contacts}
            editable={raci.editable}
          />
        ) : (
          <fieldset className="editor-fieldset" disabled={readOnly}>
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
                          aria-label={`第 ${index + 1} 个人物的备注`}
                          placeholder="备注"
                          value={person.note}
                          onChange={(event) => setPerson(person.key, { note: event.target.value })}
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
                      people: [...value.people, { key: newRowKey(), name: '', note: '' }],
                    })
                  }
                >
                  <PersonAddIcon />
                </IconButton>
                {errors.people && <p className="field-error">{errors.people}</p>}
              </div>
            </div>
          </fieldset>
        )}
      </section>

      {/* 4. 子任务 */}
      <section className="editor-module" aria-label="子任务清单">
        <fieldset className="editor-fieldset" disabled={readOnly}>
          <div className="editor-field editor-field-top" role="group" aria-label="子任务">
            <FieldIcon label="子任务">
              <ChecklistIcon />
            </FieldIcon>
            <div className="editor-field-body">
              {value.subtasks.length > 0 && (
                <ul className="subtask-edit-list">
                  {value.subtasks.map((row, index) => (
                    <li key={row.key} className="subtask-edit-row">
                      {subtaskChecks && (
                        <input
                          type="checkbox"
                          className="subtask-check"
                          aria-label={`完成子任务：${row.title}`}
                          checked={row.id ? subtaskChecks.isChecked(row.id) : false}
                          disabled={!row.id || !subtaskChecks.canCheck}
                          onChange={(event) =>
                            row.id && subtaskChecks.onToggle(row.id, event.target.checked)
                          }
                        />
                      )}
                      <input
                        aria-label={`第 ${index + 1} 个子任务`}
                        placeholder="子任务"
                        value={row.title}
                        onChange={(event) => setSubtask(row.key, event.target.value)}
                      />
                      <IconButton
                        label={`删除第 ${index + 1} 个子任务`}
                        onClick={() =>
                          onChange({ subtasks: value.subtasks.filter((s) => s.key !== row.key) })
                        }
                      >
                        <TrashIcon size={16} />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              )}
              <IconButton
                label="添加子任务"
                className="add-person"
                onClick={() =>
                  onChange({ subtasks: [...value.subtasks, { key: newRowKey(), title: '' }] })
                }
              >
                <PlusIcon size={16} />
              </IconButton>
            </div>
          </div>
        </fieldset>
      </section>
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
                    <PersonName name={nameOf(a)} />
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
