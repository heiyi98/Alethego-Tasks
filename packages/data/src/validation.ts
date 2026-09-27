import {
  isValidRecurrenceRule,
  normalizePeopleDrafts,
  normalizeTaskTitle,
  type TaskPersonDraft,
} from '@alethego/core';

import { DataError } from './errors';
import type { NewTask, TaskPatch } from './interfaces/repositories';

function requireTitle(title: string): string {
  const normalized = normalizeTaskTitle(title);
  if (normalized === null) throw new DataError('invalid', '任务标题不能为空');
  return normalized;
}

function checkRecurrence(rule: string | null | undefined, dtstart: Date | null | undefined) {
  if (!rule) return;
  if (!isValidRecurrenceRule(rule)) throw new DataError('invalid', `无效的循环规则：${rule}`);
  if (dtstart === null) throw new DataError('invalid', '循环任务需要起始时间');
}

export function validateNewTask(input: NewTask): NewTask {
  checkRecurrence(input.recurrenceRule, input.recurrenceDtstart ?? null);
  return { ...input, title: requireTitle(input.title) };
}

export function validateTaskPatch(patch: TaskPatch): TaskPatch {
  checkRecurrence(patch.recurrenceRule, patch.recurrenceDtstart);
  return patch.title === undefined ? patch : { ...patch, title: requireTitle(patch.title) };
}

export function validatePeopleDrafts(drafts: readonly TaskPersonDraft[]): TaskPersonDraft[] {
  const result = normalizePeopleDrafts(drafts);
  if (!result.ok) throw new DataError('invalid', `第 ${result.index + 1} 个人物缺少姓名`);
  return result.people;
}
