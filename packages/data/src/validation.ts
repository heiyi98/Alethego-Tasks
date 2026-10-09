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
  // 组任务不能收藏（重要性组任务也有）
  if (input.projectId && input.isStarred) {
    throw new DataError('invalid', '组任务不能收藏');
  }
  if (Boolean(input.groupId) !== Boolean(input.projectId)) {
    throw new DataError('invalid', '组任务必须属于一个项目');
  }
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

/** 分类名去除首尾空白且不能为空；描述去除首尾空白 */
export function validateCategoryInput<T extends { name?: string; description?: string }>(
  input: T,
): T {
  const result = { ...input };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new DataError('invalid', '分类名称不能为空');
    result.name = name;
  }
  if (input.description !== undefined) result.description = input.description.trim();
  return result;
}
