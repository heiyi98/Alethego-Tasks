import {
  normalizeColor,
  type OccurrenceStatus,
  type RecurrenceOccurrence,
  type ReconcileResult,
  type Task,
} from '@alethego/core';
import type { PostgrestError } from '@supabase/supabase-js';

import { DataError, type DataErrorCode } from '../errors';
import type {
  CategoryPatch,
  ICategoryRepository,
  IOccurrenceRepository,
  ITaskRepository,
  NewCategory,
  NewTask,
  TaskListQuery,
  TaskPatch,
} from '../interfaces/repositories';
import type { IRemoteStore } from '../interfaces/stores';
import type { TableUpdate } from './database.types';
import {
  categoryFromRow,
  occurrenceFromRow,
  taskFromRow,
  taskPatchToUpdate,
  taskToInsert,
} from './mappers';
import type { TaskAppSupabaseClient } from './supabase-client';

function errorCode(error: PostgrestError): DataErrorCode {
  switch (error.code) {
    case 'PGRST116':
      return 'not_found';
    case '23505':
      return 'conflict';
    case '23514':
    case '23503':
    case '22P02':
      return 'invalid';
    default:
      return 'unknown';
  }
}

function unwrap<T>(result: { data: T | null; error: PostgrestError | null }, action: string): T {
  if (result.error) {
    throw new DataError(errorCode(result.error), `${action}失败：${result.error.message}`, {
      cause: result.error,
    });
  }
  if (result.data === null) throw new DataError('not_found', `${action}失败：未找到数据`);
  return result.data;
}

export class SupabaseTaskRepository implements ITaskRepository {
  constructor(private readonly client: TaskAppSupabaseClient) {}

  async list(query: TaskListQuery = {}): Promise<Task[]> {
    let request = this.client.from('tasks').select('*').order('created_at', { ascending: false });

    if (query.categoryIds && query.categoryIds.length > 0) {
      const links = unwrap(
        await this.client
          .from('task_categories')
          .select('task_id')
          .in('category_id', [...query.categoryIds]),
        '按分类查询任务',
      );
      const taskIds = [...new Set(links.map((link) => link.task_id))];
      if (taskIds.length === 0) return [];
      request = request.in('id', taskIds);
    }

    return unwrap(await request, '查询任务列表').map(taskFromRow);
  }

  async getById(id: string): Promise<Task | null> {
    const row = unwrap(
      await this.client.from('tasks').select('*').eq('id', id).maybeSingle(),
      '查询任务',
    );
    return row ? taskFromRow(row) : null;
  }

  async create(input: NewTask): Promise<Task> {
    return taskFromRow(
      unwrap(
        await this.client.from('tasks').insert(taskToInsert(input)).select().single(),
        '创建任务',
      ),
    );
  }

  async update(id: string, patch: TaskPatch): Promise<Task> {
    return taskFromRow(
      unwrap(
        await this.client
          .from('tasks')
          .update(taskPatchToUpdate(patch))
          .eq('id', id)
          .select()
          .single(),
        '更新任务',
      ),
    );
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.client.from('tasks').delete().eq('id', id);
    if (error) unwrap({ data: null, error }, '删除任务');
  }
}

export class SupabaseCategoryRepository implements ICategoryRepository {
  constructor(private readonly client: TaskAppSupabaseClient) {}

  async list() {
    return unwrap(
      await this.client.from('categories').select('*').order('created_at'),
      '查询分类',
    ).map(categoryFromRow);
  }

  async create(input: NewCategory) {
    return categoryFromRow(
      unwrap(
        await this.client
          .from('categories')
          .insert({ ...input, color: normalizeColor(input.color) })
          .select()
          .single(),
        '创建分类',
      ),
    );
  }

  async update(id: string, patch: CategoryPatch) {
    return categoryFromRow(
      unwrap(
        await this.client
          .from('categories')
          .update(
            patch.color === undefined ? patch : { ...patch, color: normalizeColor(patch.color) },
          )
          .eq('id', id)
          .select()
          .single(),
        '更新分类',
      ),
    );
  }

  async delete(id: string) {
    const { error } = await this.client.from('categories').delete().eq('id', id);
    if (error) unwrap({ data: null, error }, '删除分类');
  }

  async listCategoryIdsByTask(taskIds: readonly string[]) {
    const result = new Map<string, string[]>();
    if (taskIds.length === 0) return result;
    const links = unwrap(
      await this.client
        .from('task_categories')
        .select('task_id, category_id')
        .in('task_id', [...taskIds]),
      '查询任务分类',
    );
    for (const link of links) {
      const ids = result.get(link.task_id) ?? [];
      ids.push(link.category_id);
      result.set(link.task_id, ids);
    }
    return result;
  }

  async setTaskCategories(taskId: string, categoryIds: readonly string[]) {
    // MVP：先删后增，非原子；需要时可改为数据库函数
    let removal = this.client.from('task_categories').delete().eq('task_id', taskId);
    if (categoryIds.length > 0) {
      removal = removal.not('category_id', 'in', `(${categoryIds.join(',')})`);
    }
    const { error } = await removal;
    if (error) unwrap({ data: null, error }, '更新任务分类');

    if (categoryIds.length === 0) return;
    const { error: upsertError } = await this.client.from('task_categories').upsert(
      categoryIds.map((categoryId) => ({ task_id: taskId, category_id: categoryId })),
      { onConflict: 'task_id,category_id', ignoreDuplicates: true },
    );
    if (upsertError) unwrap({ data: null, error: upsertError }, '更新任务分类');
  }
}

export class SupabaseOccurrenceRepository implements IOccurrenceRepository {
  constructor(private readonly client: TaskAppSupabaseClient) {}

  async listByTask(taskId: string): Promise<RecurrenceOccurrence[]> {
    return unwrap(
      await this.client
        .from('recurrence_occurrences')
        .select('*')
        .eq('task_id', taskId)
        .order('occurrence_date'),
      '查询循环实例',
    ).map(occurrenceFromRow);
  }

  async setStatus(id: string, status: OccurrenceStatus, completedAt: Date | null) {
    const update: TableUpdate<'recurrence_occurrences'> = {
      status,
      completed_at: completedAt ? completedAt.toISOString() : null,
    };
    return occurrenceFromRow(
      unwrap(
        await this.client
          .from('recurrence_occurrences')
          .update(update)
          .eq('id', id)
          .select()
          .single(),
        '更新循环实例',
      ),
    );
  }

  async applyReconcile(taskId: string, result: ReconcileResult) {
    if (result.toCreate.length > 0) {
      const { error } = await this.client.from('recurrence_occurrences').upsert(
        result.toCreate.map((o) => ({
          task_id: taskId,
          occurrence_date: o.occurrenceDate.toISOString(),
          status: o.status,
        })),
        { onConflict: 'task_id,occurrence_date', ignoreDuplicates: true },
      );
      if (error) unwrap({ data: null, error }, '生成循环实例');
    }

    if (result.toMarkMissed.length > 0) {
      // 只改仍为 pending 的记录，避免覆盖用户在此期间的手动修改
      const { error } = await this.client
        .from('recurrence_occurrences')
        .update({ status: 'missed' })
        .in('id', result.toMarkMissed)
        .eq('status', 'pending');
      if (error) unwrap({ data: null, error }, '归档循环实例');
    }
  }
}

export class SupabaseRemoteStore implements IRemoteStore {
  readonly kind = 'remote' as const;
  readonly tasks: SupabaseTaskRepository;
  readonly categories: SupabaseCategoryRepository;
  readonly occurrences: SupabaseOccurrenceRepository;

  constructor(client: TaskAppSupabaseClient) {
    this.tasks = new SupabaseTaskRepository(client);
    this.categories = new SupabaseCategoryRepository(client);
    this.occurrences = new SupabaseOccurrenceRepository(client);
  }
}
