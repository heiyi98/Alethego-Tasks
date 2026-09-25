import {
  isImportanceLevel,
  type Category,
  type RecurrenceOccurrence,
  type Task,
} from '@alethego/core';

import { DataError } from '../errors';
import type { NewTask, TaskPatch } from '../interfaces/repositories';
import type { TableInsert, TableRow, TableUpdate } from './database.types';

/** 数据库行（snake_case、ISO 字符串）与领域对象（camelCase、Date）之间的转换。 */

const toDate = (value: string): Date => new Date(value);
const toNullableDate = (value: string | null): Date | null => (value ? new Date(value) : null);
const toNullableIso = (value: Date | null | undefined): string | null =>
  value ? value.toISOString() : null;

export function taskFromRow(row: TableRow<'tasks'>): Task {
  if (!isImportanceLevel(row.importance_level)) {
    throw new DataError(
      'invalid',
      `任务 ${row.id} 的 importance_level 超出 0-5：${row.importance_level}`,
    );
  }
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    description: row.description,
    deadlineAt: toNullableDate(row.deadline_at),
    importanceLevel: row.importance_level,
    recurrenceRule: row.recurrence_rule,
    recurrenceDtstart: toNullableDate(row.recurrence_dtstart),
    completedAt: toNullableDate(row.completed_at),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

export function taskToInsert(input: NewTask): TableInsert<'tasks'> {
  return {
    title: input.title,
    description: input.description ?? '',
    deadline_at: toNullableIso(input.deadlineAt),
    importance_level: input.importanceLevel ?? 0,
    recurrence_rule: input.recurrenceRule ?? null,
    recurrence_dtstart: toNullableIso(input.recurrenceDtstart),
  };
}

export function taskPatchToUpdate(patch: TaskPatch): TableUpdate<'tasks'> {
  const update: TableUpdate<'tasks'> = {};
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.deadlineAt !== undefined) update.deadline_at = toNullableIso(patch.deadlineAt);
  if (patch.importanceLevel !== undefined) update.importance_level = patch.importanceLevel;
  if (patch.recurrenceRule !== undefined) update.recurrence_rule = patch.recurrenceRule;
  if (patch.recurrenceDtstart !== undefined) {
    update.recurrence_dtstart = toNullableIso(patch.recurrenceDtstart);
  }
  if (patch.completedAt !== undefined) update.completed_at = toNullableIso(patch.completedAt);
  return update;
}

export function categoryFromRow(row: TableRow<'categories'>): Category {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    color: row.color,
    createdAt: toDate(row.created_at),
  };
}

export function occurrenceFromRow(row: TableRow<'recurrence_occurrences'>): RecurrenceOccurrence {
  return {
    id: row.id,
    taskId: row.task_id,
    occurrenceDate: toDate(row.occurrence_date),
    status: row.status,
    completedAt: toNullableDate(row.completed_at),
    createdAt: toDate(row.created_at),
  };
}
