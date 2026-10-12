import {
  IMPORTANCE_DEFAULT,
  normalizePeopleDrafts,
  normalizeTaskTitle,
  type ImportanceLevel,
  type TaskPerson,
  type TaskPersonDraft,
  type EndMode,
  type RelationRef,
  type Task,
  type TaskRelation,
} from '@alethego/core';
import type {
  AssignmentDraft,
  NewTask,
  ScheduleInput,
  TaskDetail,
  TaskPatch,
} from '@alethego/data';

import { toDateValue } from './format';
import {
  defaultRecurrenceForm,
  isRecurring,
  recurrenceFormFromTask,
  recurrencePatch,
  sameRecurrence,
  type RecurrenceFormState,
} from './recurrence-form';

/**
 * 任务面板的表单值：新建与编辑共用同一份结构与同一个组件（TaskEditor）。
 * 截止日期只到"哪一天"（YYYY-MM-DD），那一天过完才算已错过。
 * 循环任务：第二行的日期就是开始日期；建好后只显示当前这一次的日期，不能改。要换起点就关掉循环重新设。
 * 关掉循环：当前这一次变成普通任务（保留日期和子任务勾选），以后的各次消失，过去的历史保留。
 */

export interface PersonRow {
  /** React 列表 key；新增行没有 id */
  key: string;
  id?: string;
  name: string;
  note: string;
}

/** 子任务清单的一行：有 id 的是已保存的子任务 */
export interface SubtaskRow {
  key: string;
  id?: string;
  title: string;
}

export interface TaskFormValue {
  title: string;
  description: string;
  /** 截止日期 YYYY-MM-DD；空字符串 = 没有截止日期。循环任务：开始日期 / 当前这一次的日期 */
  deadline: string;
  importanceLevel: ImportanceLevel;
  categoryIds: string[];
  completed: boolean;
  isStarred: boolean;
  recurrence: RecurrenceFormState;
  people: PersonRow[];
  /** RACI（管理组）；其他容器为空 */
  raci: AssignmentDraft[];
  /** 开始 / 结束两行逻辑（有"任务关系"的任务）；其他任务为 null */
  schedule: ScheduleFormValue | null;
  /** 子任务清单（只有标题；勾选不在表单里，勾了立即生效） */
  subtasks: SubtaskRow[];
}

/** 一个关系：于〔某任务〕的〔开始 / 结束〕+ 偏移；scopeId 是选它时所在的项目或分类（只在界面上用） */
export interface RelationDraft extends RelationRef {
  scopeId: string;
}

/**
 * 两行逻辑。结束是固定日期时，日期就是第二行的截止日期（deadline）。
 * 没选好任务的关系（predecessorId 为空）不保存。
 */
export interface ScheduleFormValue {
  startMode: 'date' | 'relations';
  /** 开始的固定日期 YYYY-MM-DD；空 = 没有开始 */
  startOn: string;
  startRelations: RelationDraft[];
  endMode: EndMode;
  endAfterDays: number;
  endRelations: RelationDraft[];
}

export function scheduleFormFrom(
  task: Pick<Task, 'startOn' | 'endAfterDays'>,
  relations: readonly TaskRelation[],
  scopeOf: (predecessorId: string) => string,
): ScheduleFormValue {
  const drafts = (side: 'start' | 'end') =>
    relations
      .filter((r) => r.side === side)
      .map((r) => ({
        predecessorId: r.predecessorId,
        anchor: r.anchor,
        offsetDays: r.offsetDays,
        scopeId: scopeOf(r.predecessorId),
      }));
  const startRelations = drafts('start');
  const endRelations = drafts('end');
  return {
    startMode: startRelations.length > 0 ? 'relations' : 'date',
    startOn: startRelations.length > 0 ? '' : (task.startOn ?? ''),
    startRelations,
    endMode:
      task.endAfterDays !== null ? 'after_start' : endRelations.length > 0 ? 'relations' : 'date',
    endAfterDays: task.endAfterDays ?? 1,
    endRelations,
  };
}

/** 两行逻辑 → 保存用的输入（只保留当前方式用到的部分） */
export function scheduleInputFrom(schedule: ScheduleFormValue): ScheduleInput {
  const refs = (list: readonly RelationDraft[]) =>
    list
      .filter((r) => r.predecessorId)
      .map(({ predecessorId, anchor, offsetDays }) => ({ predecessorId, anchor, offsetDays }));
  return {
    startOn: schedule.startMode === 'date' ? schedule.startOn || null : null,
    startRelations: schedule.startMode === 'relations' ? refs(schedule.startRelations) : [],
    endAfterDays: schedule.endMode === 'after_start' ? schedule.endAfterDays : null,
    endRelations: schedule.endMode === 'relations' ? refs(schedule.endRelations) : [],
  };
}

/** 两行逻辑保存的内容是否相同 */
export function sameSchedule(a: ScheduleFormValue | null, b: ScheduleFormValue | null): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(scheduleInputFrom(a)) === JSON.stringify(scheduleInputFrom(b));
}

let rowSeq = 0;
export const newRowKey = () => `row-${++rowSeq}`;

export function emptyTaskForm(categoryIds: string[] = []): TaskFormValue {
  return {
    title: '',
    description: '',
    deadline: '',
    importanceLevel: IMPORTANCE_DEFAULT,
    categoryIds,
    completed: false,
    isStarred: false,
    recurrence: defaultRecurrenceForm(),
    people: [],
    raci: [],
    schedule: null,
    subtasks: [],
  };
}

export function subtaskRows(subtasks: readonly { id: string; title: string }[]): SubtaskRow[] {
  return subtasks.map((s) => ({ key: s.id, id: s.id, title: s.title }));
}

/** 写入用的子任务清单：去掉空白的行 */
export function subtaskDrafts(rows: readonly SubtaskRow[]): { id?: string; title: string }[] {
  return rows
    .filter((row) => row.title.trim())
    .map((row) => (row.id ? { id: row.id, title: row.title.trim() } : { title: row.title.trim() }));
}

/** 两份子任务清单是否相同（顺序、标题；空白的新行不算） */
export function sameSubtasks(a: readonly SubtaskRow[], b: readonly SubtaskRow[]): boolean {
  const key = (rows: readonly SubtaskRow[]) =>
    JSON.stringify(subtaskDrafts(rows).map((d) => [d.id ?? '', d.title]));
  return key(a) === key(b);
}

export function peopleRows(people: readonly TaskPerson[]): PersonRow[] {
  return people.map((p) => ({ key: p.id, id: p.id, name: p.name, note: p.note }));
}

/**
 * 已保存的任务 → 表单。currentDate：循环任务当前这一次的日期（第二行显示它）；
 * 规则里一个日子都没有时为 null，显示开始日期。
 */
export function taskFormFromDetail(
  detail: TaskDetail,
  raci: readonly AssignmentDraft[] = [],
  schedule: ScheduleFormValue | null = null,
  subtasks: readonly { id: string; title: string }[] = [],
  currentDate: string | null = null,
): TaskFormValue {
  const { task } = detail;
  const recurring = task.recurrenceRule !== null;
  const deadline = recurring
    ? (currentDate ?? task.recurrenceStartOn ?? '')
    : (task.deadlineOn ?? '');
  return {
    title: task.title,
    description: task.description,
    deadline,
    importanceLevel: task.importanceLevel,
    categoryIds: detail.categoryIds,
    completed: task.completedAt !== null,
    isStarred: task.isStarred,
    recurrence: recurrenceFormFromTask(task),
    people: peopleRows(detail.people),
    raci: [...raci],
    schedule,
    subtasks: subtaskRows(subtasks),
  };
}

/** 两组 RACI 是否相同（不计顺序） */
export function sameRaci(a: readonly AssignmentDraft[], b: readonly AssignmentDraft[]): boolean {
  const key = (rows: readonly AssignmentDraft[]) =>
    rows
      .map((r) => `${r.role}:${r.userId ?? ''}:${r.contactId ?? ''}`)
      .sort()
      .join('|');
  return key(a) === key(b);
}

/** 新建草稿是否已填写了内容（用于"放弃"前的确认）；与页面默认值（所选分类、收藏里的标星）相同不算 */
export function isDraftDirty(
  form: TaskFormValue,
  defaults: {
    categoryIds: readonly string[];
    isStarred: boolean;
    raci?: readonly AssignmentDraft[];
  },
): boolean {
  const defaultCategoryIds = defaults.categoryIds;
  return (
    form.title.trim() !== '' ||
    form.description.trim() !== '' ||
    form.deadline !== '' ||
    form.importanceLevel !== IMPORTANCE_DEFAULT ||
    form.isStarred !== defaults.isStarred ||
    isRecurring(form.recurrence) ||
    form.people.some((p) => p.name.trim() || p.note.trim()) ||
    form.subtasks.some((s) => s.title.trim()) ||
    [...form.categoryIds].sort().join() !== [...defaultCategoryIds].sort().join() ||
    !sameRaci(form.raci, defaults.raci ?? [])
  );
}

export interface FormErrors {
  title?: string;
  recurrence?: string;
  people?: string;
}

export function validateTaskForm(form: TaskFormValue): FormErrors {
  const errors: FormErrors = {};
  if (!normalizeTaskTitle(form.title)) errors.title = '标题不能为空';
  const recurrence = recurrencePatch(form.recurrence);
  if (!recurrence.ok) errors.recurrence = recurrence.error;
  const people = normalizePeopleDrafts(form.people);
  if (!people.ok) errors.people = `第 ${people.index + 1} 个人物缺少姓名`;
  return errors;
}

/**
 * 新建：表单 → 任务字段（调用前应先通过 validateTaskForm）。
 * 传了 groupId 就是这个组的任务：组任务有重要性（全组共用），不使用分类和收藏。
 */
export function newTaskFromForm(
  form: TaskFormValue,
  container: { groupId: string; projectId: string } | null = null,
): NewTask {
  const groupId = container?.groupId ?? null;
  const recurrence = recurrencePatch(form.recurrence);
  const recurring = recurrence.ok && recurrence.recurrenceRule !== null;
  // 循环任务没选开始日期：从今天开始
  const start = form.deadline || toDateValue(new Date());
  return {
    title: normalizeTaskTitle(form.title) ?? form.title,
    description: form.description.trim(),
    importanceLevel: form.importanceLevel,
    // 循环任务：第二行的日期是开始日期；截止日期不用
    deadlineOn: recurring ? null : form.deadline || null,
    isStarred: groupId ? false : form.isStarred,
    recurrenceRule: recurrence.ok ? recurrence.recurrenceRule : null,
    recurrenceStartOn: recurring ? start : null,
    ...(container ? { groupId: container.groupId, projectId: container.projectId } : {}),
  };
}

export interface TaskChanges {
  /**
   * 先关掉循环：当前这一次（这个日期）变成普通任务，以后的各次消失，过去的历史保留。
   * 原来是循环任务、现在关掉了（或者什么都没选），或者关掉又打开（重新设）时有值
   */
  stopRecurrenceAt: string | null;
  /** 然后写入的字段 */
  patch: TaskPatch;
}

/**
 * 编辑：比较当前表单与上次保存的表单，只生成有变化且合法的字段。
 * 标题为空、循环规则不合法时跳过对应字段（界面提示错误，等用户改好后再保存）。
 */
export function taskChangesFromForms(current: TaskFormValue, saved: TaskFormValue): TaskChanges {
  const patch: TaskPatch = {};
  const title = normalizeTaskTitle(current.title);
  if (title && current.title !== saved.title) patch.title = title;
  if (current.description !== saved.description) patch.description = current.description;
  if (current.importanceLevel !== saved.importanceLevel) {
    patch.importanceLevel = current.importanceLevel;
  }
  if (current.isStarred !== saved.isStarred) patch.isStarred = current.isStarred;

  const recurrence = recurrencePatch(current.recurrence);
  if (!recurrence.ok) return { stopRecurrenceAt: null, patch };
  const wasRecurring = isRecurring(saved.recurrence);
  const nowRecurring = recurrence.recurrenceRule !== null;
  const restarted = wasRecurring && nowRecurring && current.recurrence.restarted;
  // 已保存的循环任务：第二行显示的是当前这一次的日期
  const stopRecurrenceAt =
    wasRecurring && (!nowRecurring || restarted) ? saved.deadline || null : null;

  if (nowRecurring) {
    if (!wasRecurring || restarted) {
      // 开始循环（或者关掉后重新设）：第二行的日期是开始日期，没选就是今天
      patch.recurrenceRule = recurrence.recurrenceRule;
      patch.recurrenceStartOn = current.deadline || toDateValue(new Date());
    } else if (!sameRecurrence(current.recurrence, saved.recurrence)) {
      // 只改规则：开始日期不变，过去的历史不变
      patch.recurrenceRule = recurrence.recurrenceRule;
    }
    return { stopRecurrenceAt, patch };
  }

  // 普通任务（包括刚关掉循环的）：截止日期与完成状态
  const baseDeadline = wasRecurring ? (stopRecurrenceAt ?? '') : saved.deadline;
  if (current.deadline !== baseDeadline) patch.deadlineOn = current.deadline || null;
  const baseCompleted = wasRecurring ? false : saved.completed;
  if (current.completed !== baseCompleted) {
    patch.completedAt = current.completed ? new Date() : null;
  }
  return { stopRecurrenceAt, patch };
}

export function peopleDrafts(rows: readonly PersonRow[]): TaskPersonDraft[] {
  return rows.map((r) => ({ ...(r.id ? { id: r.id } : {}), name: r.name, note: r.note }));
}

export function samePeople(a: readonly PersonRow[], b: readonly PersonRow[]): boolean {
  const key = (rows: readonly PersonRow[]) =>
    JSON.stringify(
      rows
        .filter((r) => r.name.trim() || r.note.trim())
        .map((r) => [r.id ?? null, r.name.trim(), r.note.trim()]),
    );
  return key(a) === key(b);
}
