import {
  IMPORTANCE_DEFAULT,
  endOfLocalDay,
  normalizeLocationDraft,
  normalizePeopleDrafts,
  normalizeTaskTitle,
  type ImportanceLevel,
  type TaskLocation,
  type TaskLocationDraft,
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

import { fromDateTimeLocalValue, fromDateValue, toDateValue, toTimeValue } from './format';
import {
  recurrenceFormFromTask,
  recurrencePatch,
  type RecurrenceFormState,
} from './recurrence-form';

/**
 * 任务面板的表单值：新建与编辑共用同一份结构与同一个组件（TaskEditor）。
 * 截止时间：本地日期（YYYY-MM-DD）+ 可选的时刻（HH:MM）。
 * 没选时刻 = 当天最后一刻（过完当天才算已错过）；选了时刻 = 过了那个时刻就算已错过。
 */

export interface PersonRow {
  /** React 列表 key；新增行没有 id */
  key: string;
  id?: string;
  name: string;
  relation: string;
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
  /** 本地日期 YYYY-MM-DD；空字符串 = 没有截止日期 */
  deadline: string;
  /** 本地时刻 HH:MM；空字符串 = 没选具体时刻 */
  deadlineTime: string;
  importanceLevel: ImportanceLevel;
  categoryIds: string[];
  completed: boolean;
  isStarred: boolean;
  recurrence: RecurrenceFormState;
  location: TaskLocationDraft;
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
 * 两行逻辑。结束是固定日期时，日期就是上面的截止日期（deadline / deadlineTime）。
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
export function scheduleInputFrom(schedule: ScheduleFormValue, timeZone: string): ScheduleInput {
  const refs = (list: readonly RelationDraft[]) =>
    list
      .filter((r) => r.predecessorId)
      .map(({ predecessorId, anchor, offsetDays }) => ({ predecessorId, anchor, offsetDays }));
  return {
    startOn: schedule.startMode === 'date' ? schedule.startOn || null : null,
    startRelations: schedule.startMode === 'relations' ? refs(schedule.startRelations) : [],
    endAfterDays: schedule.endMode === 'after_start' ? schedule.endAfterDays : null,
    endRelations: schedule.endMode === 'relations' ? refs(schedule.endRelations) : [],
    dateZone: timeZone,
  };
}

/** 两行逻辑保存的内容是否相同 */
export function sameSchedule(
  a: ScheduleFormValue | null,
  b: ScheduleFormValue | null,
  timeZone: string,
): boolean {
  if (!a || !b) return a === b;
  return (
    JSON.stringify(scheduleInputFrom(a, timeZone)) ===
    JSON.stringify(scheduleInputFrom(b, timeZone))
  );
}

let rowSeq = 0;
export const newRowKey = () => `row-${++rowSeq}`;

export function emptyTaskForm(categoryIds: string[] = []): TaskFormValue {
  return {
    title: '',
    description: '',
    deadline: '',
    deadlineTime: '',
    importanceLevel: IMPORTANCE_DEFAULT,
    categoryIds,
    completed: false,
    isStarred: false,
    recurrence: { enabled: false, spec: null, customRule: null, dtstart: '' },
    location: { name: '', address: '' },
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
  return people.map((p) => ({ key: p.id, id: p.id, name: p.name, relation: p.relation }));
}

export function locationDraft(location: TaskLocation | null): TaskLocationDraft {
  return { name: location?.name ?? '', address: location?.address ?? '' };
}

export function taskFormFromDetail(
  detail: TaskDetail,
  timeZone: string,
  raci: readonly AssignmentDraft[] = [],
  schedule: ScheduleFormValue | null = null,
  subtasks: readonly { id: string; title: string }[] = [],
): TaskFormValue {
  const { task } = detail;
  return {
    title: task.title,
    description: task.description,
    deadline: task.deadlineAt ? toDateValue(task.deadlineAt) : '',
    deadlineTime: task.deadlineAt ? toTimeValue(task.deadlineAt, timeZone) : '',
    importanceLevel: task.importanceLevel,
    categoryIds: detail.categoryIds,
    completed: task.completedAt !== null,
    isStarred: task.isStarred,
    recurrence: recurrenceFormFromTask(task),
    location: locationDraft(detail.location),
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

/** 截止日期（本地日期）+ 可选时刻 → 截止时间；没选时刻时取该日的本地日终点 */
export function deadlineFromForm(date: string, time: string, timeZone: string): Date | null {
  if (!date) return null;
  if (time) return fromDateTimeLocalValue(`${date}T${time}`);
  const day = fromDateValue(date);
  return day ? endOfLocalDay(day, timeZone) : null;
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
    form.deadlineTime !== '' ||
    form.importanceLevel !== IMPORTANCE_DEFAULT ||
    form.isStarred !== defaults.isStarred ||
    form.recurrence.enabled ||
    form.location.name.trim() !== '' ||
    form.location.address.trim() !== '' ||
    form.people.some((p) => p.name.trim() || p.relation.trim()) ||
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
  timeZone: string,
  container: { groupId: string; projectId: string } | null = null,
): NewTask {
  const groupId = container?.groupId ?? null;
  const recurrence = recurrencePatch(form.recurrence);
  const recurring = recurrence.ok && recurrence.recurrenceRule !== null;
  return {
    title: normalizeTaskTitle(form.title) ?? form.title,
    description: form.description.trim(),
    importanceLevel: form.importanceLevel,
    deadlineAt: recurring ? null : deadlineFromForm(form.deadline, form.deadlineTime, timeZone),
    isStarred: groupId ? false : form.isStarred,
    recurrenceRule: recurrence.ok ? recurrence.recurrenceRule : null,
    recurrenceDtstart: recurrence.ok ? (recurrence.recurrenceDtstart ?? null) : null,
    ...(container ? { groupId: container.groupId, projectId: container.projectId } : {}),
  };
}

/**
 * 编辑：比较当前表单与上次保存的表单，只生成有变化且合法的字段。
 * 标题为空、循环规则不合法时跳过对应字段（界面提示错误，等用户改好后再保存）。
 */
export function taskPatchFromForms(
  current: TaskFormValue,
  saved: TaskFormValue,
  timeZone: string,
): TaskPatch {
  const patch: TaskPatch = {};
  const title = normalizeTaskTitle(current.title);
  if (title && current.title !== saved.title) patch.title = title;
  if (current.description !== saved.description) patch.description = current.description;
  if (current.importanceLevel !== saved.importanceLevel) {
    patch.importanceLevel = current.importanceLevel;
  }
  if (current.isStarred !== saved.isStarred) patch.isStarred = current.isStarred;

  const recurrenceChanged = JSON.stringify(current.recurrence) !== JSON.stringify(saved.recurrence);
  const recurrence = recurrencePatch(current.recurrence);
  if (recurrenceChanged && recurrence.ok) {
    patch.recurrenceRule = recurrence.recurrenceRule;
    if (recurrence.recurrenceDtstart) patch.recurrenceDtstart = recurrence.recurrenceDtstart;
  }
  // 循环任务的截止时间与完成状态由规则和每次实例决定，这两个字段只对普通任务生效
  if (!current.recurrence.enabled) {
    if (current.deadline !== saved.deadline || current.deadlineTime !== saved.deadlineTime) {
      patch.deadlineAt = deadlineFromForm(current.deadline, current.deadlineTime, timeZone);
    }
    if (current.completed !== saved.completed) {
      patch.completedAt = current.completed ? new Date() : null;
    }
  }
  return patch;
}

export function peopleDrafts(rows: readonly PersonRow[]): TaskPersonDraft[] {
  return rows.map((r) => ({ ...(r.id ? { id: r.id } : {}), name: r.name, relation: r.relation }));
}

export function sameLocation(a: TaskLocationDraft, b: TaskLocationDraft): boolean {
  const na = normalizeLocationDraft(a);
  const nb = normalizeLocationDraft(b);
  return JSON.stringify(na) === JSON.stringify(nb);
}

export function samePeople(a: readonly PersonRow[], b: readonly PersonRow[]): boolean {
  const key = (rows: readonly PersonRow[]) =>
    JSON.stringify(
      rows
        .filter((r) => r.name.trim() || r.relation.trim())
        .map((r) => [r.id ?? null, r.name.trim(), r.relation.trim()]),
    );
  return key(a) === key(b);
}
