import type { Task, TaskPerson, TaskPersonDraft } from '@alethego/core';

import type { DataStore } from '../interfaces/stores';
import { validatePeopleDrafts } from '../validation';

/**
 * TaskDetailAggregator：详情页的统一查询 / 拼装层。
 * 按《04-数据模型文档》，这是唯一"知道所有扩展表存在"的模块；tasks 核心表与各扩展表互不感知。
 * 以后新增扩展表（如地图、外部任务源、协作者）只需在这里加一项，不改动 tasks 与其他扩展表。
 */

export interface TaskDetail {
  task: Task;
  categoryIds: string[];
  people: TaskPerson[];
}

export async function loadTaskDetail(store: DataStore, taskId: string): Promise<TaskDetail | null> {
  const task = await store.tasks.getById(taskId);
  if (!task) return null;
  const [links, people] = await Promise.all([
    store.categories.listCategoryIdsByTask([taskId]),
    store.people.listByTask(taskId),
  ]);
  return { task, categoryIds: links.get(taskId) ?? [], people };
}

export interface TaskExtensionsInput {
  people: readonly TaskPersonDraft[];
}

/** 保存详情页中的扩展信息（人物），返回保存后的结果 */
export async function saveTaskExtensions(
  store: DataStore,
  taskId: string,
  input: TaskExtensionsInput,
): Promise<Pick<TaskDetail, 'people'>> {
  const drafts = validatePeopleDrafts(input.people);
  return { people: await store.people.replace(taskId, drafts) };
}
