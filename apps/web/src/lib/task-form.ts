import {
  endOfLocalDay,
  normalizeLocationDraft,
  normalizePeopleDrafts,
  normalizeTaskTitle,
  type ImportanceLevel,
  type TaskLocation,
  type TaskLocationDraft,
  type TaskPerson,
  type TaskPersonDraft,
} from '@alethego/core';
import type { NewTask, TaskDetail, TaskPatch } from '@alethego/data';

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
}

let rowSeq = 0;
export const newRowKey = () => `row-${++rowSeq}`;

export function emptyTaskForm(categoryIds: string[] = []): TaskFormValue {
  return {
    title: '',
    description: '',
    deadline: '',
    deadlineTime: '',
    importanceLevel: 0,
    categoryIds,
    completed: false,
    isStarred: false,
    recurrence: { enabled: false, spec: null, customRule: null, dtstart: '' },
    location: { name: '', address: '' },
    people: [],
  };
}

export function peopleRows(people: readonly TaskPerson[]): PersonRow[] {
  return people.map((p) => ({ key: p.id, id: p.id, name: p.name, relation: p.relation }));
}

export function locationDraft(location: TaskLocation | null): TaskLocationDraft {
  return { name: location?.name ?? '', address: location?.address ?? '' };
}

export function taskFormFromDetail(detail: TaskDetail, timeZone: string): TaskFormValue {
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
  };
}

/** 截止日期（本地日期）+ 可选时刻 → 截止时间；没选时刻时取该日的本地日终点 */
export function deadlineFromForm(date: string, time: string, timeZone: string): Date | null {
  if (!date) return null;
  if (time) return fromDateTimeLocalValue(`${date}T${time}`);
  const day = fromDateValue(date);
  return day ? endOfLocalDay(day, timeZone) : null;
}

/** 新建草稿是否已填写了内容（用于"放弃"前的确认） */
export function isDraftDirty(form: TaskFormValue, defaultCategoryIds: readonly string[]): boolean {
  return (
    form.title.trim() !== '' ||
    form.description.trim() !== '' ||
    form.deadline !== '' ||
    form.deadlineTime !== '' ||
    form.importanceLevel !== 0 ||
    form.isStarred ||
    form.recurrence.enabled ||
    form.location.name.trim() !== '' ||
    form.location.address.trim() !== '' ||
    form.people.some((p) => p.name.trim() || p.relation.trim()) ||
    [...form.categoryIds].sort().join() !== [...defaultCategoryIds].sort().join()
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

/** 新建：表单 → 任务字段（调用前应先通过 validateTaskForm） */
export function newTaskFromForm(form: TaskFormValue, timeZone: string): NewTask {
  const recurrence = recurrencePatch(form.recurrence);
  const recurring = recurrence.ok && recurrence.recurrenceRule !== null;
  return {
    title: normalizeTaskTitle(form.title) ?? form.title,
    description: form.description.trim(),
    importanceLevel: form.importanceLevel,
    deadlineAt: recurring ? null : deadlineFromForm(form.deadline, form.deadlineTime, timeZone),
    isStarred: form.isStarred,
    recurrenceRule: recurrence.ok ? recurrence.recurrenceRule : null,
    recurrenceDtstart: recurrence.ok ? (recurrence.recurrenceDtstart ?? null) : null,
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
