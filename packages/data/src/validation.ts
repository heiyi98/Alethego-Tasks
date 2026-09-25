import { normalizeTaskTitle } from '@alethego/core';

import { DataError } from './errors';
import type { NewTask, TaskPatch } from './interfaces/repositories';

function requireTitle(title: string): string {
  const normalized = normalizeTaskTitle(title);
  if (normalized === null) throw new DataError('invalid', '任务标题不能为空');
  return normalized;
}

export function validateNewTask(input: NewTask): NewTask {
  return { ...input, title: requireTitle(input.title) };
}

export function validateTaskPatch(patch: TaskPatch): TaskPatch {
  return patch.title === undefined ? patch : { ...patch, title: requireTitle(patch.title) };
}
