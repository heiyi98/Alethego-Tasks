import {
  isImportanceLevel,
  type Category,
  type TaskPerson,
  type RecurrenceOccurrence,
  type Task,
} from '@alethego/core';

import { DataError } from '../errors';
import type { NewTask, TaskPatch } from '../interfaces/repositories';
import type { TableInsert, TableRow, TableUpdate } from './database.types';

/**
 * 数据库行（snake_case）与领域对象（camelCase）之间的转换。时间点是 Date；只到某一天的日期
 * （截止日期、循环的日期）两边都是 "YYYY-MM-DD"，原样传递。
 */

const toDate = (value: string): Date => new Date(value);
const toNullableDate = (value: string | null): Date | null => (value ? new Date(value) : null);
const toNullableIso = (value: Date | null | undefined): string | null =>
  value ? value.toISOString() : null;

export function taskFromRow(row: TableRow<'tasks'>): Task {
  if (!isImportanceLevel(row.importance_level)) {
    throw new DataError(
      'invalid',
      `任务 ${row.id} 的 importance_level 超出 0-3：${row.importance_level}`,
    );
  }
  return {
    id: row.id,
    ownerId: row.owner_id,
    groupId: row.group_id,
    projectId: row.project_id ?? null,
    startOn: row.start_on ?? null,
    endAfterDays: row.end_after_days ?? null,
    title: row.title,
    description: row.description,
    deadlineOn: row.deadline_on,
    importanceLevel: row.importance_level,
    recurrenceRule: row.recurrence_rule,
    recurrenceStartOn: row.recurrence_start_on,
    completedAt: toNullableDate(row.completed_at),
    // 迁移前的数据库没有这一列：视为完成即确认
    confirmedAt: toNullableDate(
      row.confirmed_at === undefined ? row.completed_at : row.confirmed_at,
    ),
    isStarred: row.is_starred,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    deletedAt: toNullableDate(row.deleted_at),
  };
}

export function taskToInsert(input: NewTask, ownerId: string): TableInsert<'tasks'> {
  return {
    owner_id: ownerId,
    group_id: input.groupId ?? null,
    project_id: input.projectId ?? null,
    title: input.title,
    description: input.description ?? '',
    deadline_on: input.deadlineOn ?? null,
    importance_level: input.importanceLevel ?? 0,
    recurrence_rule: input.recurrenceRule ?? null,
    recurrence_start_on: input.recurrenceStartOn ?? null,
    is_starred: input.isStarred ?? false,
  };
}

export function taskPatchToUpdate(patch: TaskPatch): TableUpdate<'tasks'> {
  const update: TableUpdate<'tasks'> = {};
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.deadlineOn !== undefined) update.deadline_on = patch.deadlineOn;
  if (patch.importanceLevel !== undefined) update.importance_level = patch.importanceLevel;
  if (patch.recurrenceRule !== undefined) update.recurrence_rule = patch.recurrenceRule;
  if (patch.recurrenceStartOn !== undefined) {
    update.recurrence_start_on = patch.recurrenceStartOn;
  }
  if (patch.completedAt !== undefined) update.completed_at = toNullableIso(patch.completedAt);
  if (patch.confirmedAt !== undefined) update.confirmed_at = toNullableIso(patch.confirmedAt);
  if (patch.isStarred !== undefined) update.is_starred = patch.isStarred;
  return update;
}

export function categoryFromRow(row: TableRow<'categories'>): Category {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    color: row.color,
    description: row.description,
    tools: row.tools ?? [],
    createdAt: toDate(row.created_at),
  };
}

export function occurrenceFromRow(row: TableRow<'recurrence_occurrences'>): RecurrenceOccurrence {
  return {
    id: row.id,
    taskId: row.task_id,
    occurrenceDate: row.occurrence_date,
    status: row.status,
    completedAt: toNullableDate(row.completed_at),
    createdAt: toDate(row.created_at),
  };
}

export function personFromRow(row: TableRow<'task_people'>): TaskPerson {
  return {
    id: row.id,
    taskId: row.task_id,
    name: row.name,
    note: row.note,
    contactId: row.contact_id,
    createdAt: toDate(row.created_at),
  };
}
