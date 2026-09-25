import {
  normalizeColor,
  type Category,
  type OccurrenceStatus,
  type ReconcileResult,
  type RecurrenceOccurrence,
  type Task,
} from '@alethego/core';

import { DataError } from '../errors';
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
import type { ILocalStore } from '../interfaces/stores';

/**
 * 内存版本地存储：用于测试与离线存储实现（IndexedDB / SQLite）落地前的占位。
 * 行为与数据库约束保持一致：分类颜色排他、删除级联、实例记录去重。
 */

interface MemoryState {
  ownerId: string;
  now: () => Date;
  newId: () => string;
  tasks: Map<string, Task>;
  categories: Map<string, Category>;
  /** `${taskId}:${categoryId}` */
  taskCategories: Set<string>;
  occurrences: Map<string, RecurrenceOccurrence>;
}

const linkKey = (taskId: string, categoryId: string) => `${taskId}:${categoryId}`;

function notFound(what: string, id: string): never {
  throw new DataError('not_found', `${what} ${id} 不存在`);
}

class MemoryTaskRepository implements ITaskRepository {
  constructor(private readonly state: MemoryState) {}

  async list(query: TaskListQuery = {}) {
    let tasks = [...this.state.tasks.values()];
    const categoryIds = query.categoryIds ?? [];
    if (categoryIds.length > 0) {
      tasks = tasks.filter((task) =>
        categoryIds.some((categoryId) =>
          this.state.taskCategories.has(linkKey(task.id, categoryId)),
        ),
      );
    }
    return tasks.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getById(id: string) {
    return this.state.tasks.get(id) ?? null;
  }

  async create(input: NewTask) {
    const now = this.state.now();
    const task: Task = {
      id: this.state.newId(),
      ownerId: this.state.ownerId,
      title: input.title,
      description: input.description ?? '',
      deadlineAt: input.deadlineAt ?? null,
      importanceLevel: input.importanceLevel ?? 0,
      recurrenceRule: input.recurrenceRule ?? null,
      recurrenceDtstart: input.recurrenceDtstart ?? null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.state.tasks.set(task.id, task);
    return task;
  }

  async update(id: string, patch: TaskPatch) {
    const existing = this.state.tasks.get(id) ?? notFound('任务', id);
    const updated: Task = { ...existing, ...patch, updatedAt: this.state.now() };
    this.state.tasks.set(id, updated);
    return updated;
  }

  async delete(id: string) {
    this.state.tasks.delete(id);
    for (const key of this.state.taskCategories) {
      if (key.startsWith(`${id}:`)) this.state.taskCategories.delete(key);
    }
    for (const [occurrenceId, occurrence] of this.state.occurrences) {
      if (occurrence.taskId === id) this.state.occurrences.delete(occurrenceId);
    }
  }
}

class MemoryCategoryRepository implements ICategoryRepository {
  constructor(private readonly state: MemoryState) {}

  private assertColorAvailable(color: string, exceptId?: string) {
    for (const category of this.state.categories.values()) {
      if (category.id !== exceptId && normalizeColor(category.color) === normalizeColor(color)) {
        throw new DataError('conflict', `颜色 ${color} 已被分类「${category.name}」使用`);
      }
    }
  }

  async list() {
    return [...this.state.categories.values()].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
  }

  async create(input: NewCategory) {
    this.assertColorAvailable(input.color);
    const category: Category = {
      id: this.state.newId(),
      ownerId: this.state.ownerId,
      name: input.name,
      color: normalizeColor(input.color),
      createdAt: this.state.now(),
    };
    this.state.categories.set(category.id, category);
    return category;
  }

  async update(id: string, patch: CategoryPatch) {
    const existing = this.state.categories.get(id) ?? notFound('分类', id);
    if (patch.color !== undefined) this.assertColorAvailable(patch.color, id);
    const updated: Category = {
      ...existing,
      ...patch,
      color: normalizeColor(patch.color ?? existing.color),
    };
    this.state.categories.set(id, updated);
    return updated;
  }

  async delete(id: string) {
    this.state.categories.delete(id);
    for (const key of this.state.taskCategories) {
      if (key.endsWith(`:${id}`)) this.state.taskCategories.delete(key);
    }
  }

  async listCategoryIdsByTask(taskIds: readonly string[]) {
    const wanted = new Set(taskIds);
    const result = new Map<string, string[]>();
    for (const key of this.state.taskCategories) {
      const [taskId, categoryId] = key.split(':') as [string, string];
      if (!wanted.has(taskId)) continue;
      result.set(taskId, [...(result.get(taskId) ?? []), categoryId]);
    }
    return result;
  }

  async setTaskCategories(taskId: string, categoryIds: readonly string[]) {
    if (!this.state.tasks.has(taskId)) notFound('任务', taskId);
    for (const categoryId of categoryIds) {
      if (!this.state.categories.has(categoryId)) notFound('分类', categoryId);
    }
    for (const key of this.state.taskCategories) {
      if (key.startsWith(`${taskId}:`)) this.state.taskCategories.delete(key);
    }
    for (const categoryId of categoryIds) {
      this.state.taskCategories.add(linkKey(taskId, categoryId));
    }
  }
}

class MemoryOccurrenceRepository implements IOccurrenceRepository {
  constructor(private readonly state: MemoryState) {}

  async listByTask(taskId: string) {
    return [...this.state.occurrences.values()]
      .filter((o) => o.taskId === taskId)
      .sort((a, b) => a.occurrenceDate.getTime() - b.occurrenceDate.getTime());
  }

  async setStatus(id: string, status: OccurrenceStatus, completedAt: Date | null) {
    const existing = this.state.occurrences.get(id) ?? notFound('循环实例', id);
    const updated: RecurrenceOccurrence = { ...existing, status, completedAt };
    this.state.occurrences.set(id, updated);
    return updated;
  }

  async applyReconcile(taskId: string, result: ReconcileResult) {
    const existingDates = new Set(
      (await this.listByTask(taskId)).map((o) => o.occurrenceDate.getTime()),
    );
    for (const { occurrenceDate, status } of result.toCreate) {
      if (existingDates.has(occurrenceDate.getTime())) continue;
      const occurrence: RecurrenceOccurrence = {
        id: this.state.newId(),
        taskId,
        occurrenceDate,
        status,
        completedAt: null,
        createdAt: this.state.now(),
      };
      this.state.occurrences.set(occurrence.id, occurrence);
    }
    for (const id of result.toMarkMissed) {
      const occurrence = this.state.occurrences.get(id);
      if (occurrence?.status === 'pending') {
        this.state.occurrences.set(id, { ...occurrence, status: 'missed' });
      }
    }
  }
}

export interface InMemoryLocalStoreOptions {
  ownerId?: string;
  now?: () => Date;
  newId?: () => string;
}

export class InMemoryLocalStore implements ILocalStore {
  readonly kind = 'local' as const;
  readonly tasks: ITaskRepository;
  readonly categories: ICategoryRepository;
  readonly occurrences: IOccurrenceRepository;

  constructor(options: InMemoryLocalStoreOptions = {}) {
    const state: MemoryState = {
      ownerId: options.ownerId ?? 'local-user',
      now: options.now ?? (() => new Date()),
      newId: options.newId ?? (() => crypto.randomUUID()),
      tasks: new Map(),
      categories: new Map(),
      taskCategories: new Set(),
      occurrences: new Map(),
    };
    this.tasks = new MemoryTaskRepository(state);
    this.categories = new MemoryCategoryRepository(state);
    this.occurrences = new MemoryOccurrenceRepository(state);
  }
}
