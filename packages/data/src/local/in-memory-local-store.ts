import {
  compareByDeadline,
  computeScheduleDates,
  wouldCreateCycle,
  type TaskRelation,
  normalizeColor,
  type TaskPerson,
  type TaskPersonDraft,
  type Category,
  type OccurrenceStatus,
  type ReconcileResult,
  type RecurrenceOccurrence,
  type Project,
  type Subtask,
  type SubtaskCheck,
  type Task,
} from '@alethego/core';

import { DataError } from '../errors';
import type {
  CategoryPatch,
  ICategoryRepository,
  IOccurrenceRepository,
  ITaskPeopleRepository,
  ITaskRepository,
  ISubtaskRepository,
  IUserSettingsRepository,
  SubtaskDraft,
  NewCategory,
  NewTask,
  TaskListQuery,
  TaskPatch,
  IAssignmentRepository,
  IRelationRepository,
  ScheduleInput,
  IGroupRepository,
  IProjectRepository,
} from '../interfaces/repositories';
import type { ILocalStore } from '../interfaces/stores';
import {
  MemoryAssignmentRepository,
  MemoryGroupRepository,
  MemoryProjectRepository,
} from './in-memory-groups';
import {
  validateCategoryInput,
  validateNewTask,
  validatePeopleDrafts,
  validateTaskPatch,
} from '../validation';

/**
 * 内存版本地存储：用于测试与离线存储实现（IndexedDB / SQLite）落地前的占位。
 * 行为与数据库约束保持一致：分类颜色排他、任务软删除、按截止时间排序、实例记录去重。
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
  people: Map<string, TaskPerson>;
  projects: Map<string, Project>;
  subtasks: Subtask[];
  checks: SubtaskCheck[];
  /** 归入历史的勾选（关掉循环前作为普通任务的）：不算任务现在的勾选，也不删除 */
  archivedChecks: SubtaskCheck[];
}

const linkKey = (taskId: string, categoryId: string) => `${taskId}:${categoryId}`;

function notFound(what: string, id: string): never {
  throw new DataError('not_found', `${what} ${id} 不存在`);
}

class MemoryTaskRepository implements ITaskRepository {
  constructor(private readonly state: MemoryState) {}

  private active(id: string): Task {
    const task = this.state.tasks.get(id);
    if (!task || task.deletedAt) notFound('任务', id);
    return task;
  }

  async list(query: TaskListQuery = {}) {
    let tasks = [...this.state.tasks.values()].filter((task) => !task.deletedAt);
    const categoryIds = query.categoryIds ?? [];
    if (categoryIds.length > 0) {
      tasks = tasks.filter((task) =>
        categoryIds.some((categoryId) =>
          this.state.taskCategories.has(linkKey(task.id, categoryId)),
        ),
      );
    }
    return tasks.sort(compareByDeadline);
  }

  async getById(id: string) {
    const task = this.state.tasks.get(id);
    return task && !task.deletedAt ? task : null;
  }

  async create(input: NewTask) {
    const valid = validateNewTask(input);
    const now = this.state.now();
    const task: Task = {
      id: this.state.newId(),
      ownerId: this.state.ownerId,
      groupId: valid.groupId ?? null,
      projectId: valid.projectId ?? null,
      startOn: null,
      endAfterDays: null,
      title: valid.title,
      description: valid.description ?? '',
      deadlineOn: valid.deadlineOn ?? null,
      importanceLevel: valid.importanceLevel ?? 0,
      recurrenceRule: valid.recurrenceRule ?? null,
      recurrenceStartOn: valid.recurrenceStartOn ?? null,
      completedAt: null,
      confirmedAt: null,
      isStarred: valid.isStarred ?? false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.state.tasks.set(task.id, task);
    return task;
  }

  async update(id: string, patch: TaskPatch) {
    const merged: Task = {
      ...this.active(id),
      ...validateTaskPatch(patch),
      updatedAt: this.state.now(),
    };
    // 本机只有自己一个人（既是 R 又是 A）：完成即确认
    const updated: Task =
      patch.completedAt !== undefined ? { ...merged, confirmedAt: merged.completedAt } : merged;
    this.state.tasks.set(id, updated);
    return updated;
  }

  async delete(id: string) {
    const task = this.state.tasks.get(id);
    if (!task || task.deletedAt) return;
    const now = this.state.now();
    this.state.tasks.set(id, { ...task, deletedAt: now, updatedAt: now });
  }

  async restore(id: string) {
    const task = this.state.tasks.get(id) ?? notFound('任务', id);
    const restored: Task = { ...task, deletedAt: null, updatedAt: this.state.now() };
    this.state.tasks.set(id, restored);
    return restored;
  }

  async stopRecurrence(id: string, currentDate: string) {
    const task = this.active(id);
    if (!task.recurrenceRule) return task;
    // 当前这一次是任务现在的状态，之前的一律是历史；完成的记录不会被系统连带删除
    const mine = new Set(this.state.subtasks.filter((s) => s.taskId === id).map((s) => s.id));
    const checkedDates = new Set(
      this.state.checks
        .filter((c) => mine.has(c.subtaskId) && c.occurrenceDate !== null)
        .map((c) => c.occurrenceDate!),
    );
    const existing = new Map(
      [...this.state.occurrences.values()]
        .filter((o) => o.taskId === id)
        .map((o) => [o.occurrenceDate, o]),
    );
    // 以后勾过子任务的那几次：还没有记录的补一条（没完成），留在历史里
    for (const date of checkedDates) {
      if (date > currentDate && !existing.has(date)) {
        const occurrence: RecurrenceOccurrence = {
          id: this.state.newId(),
          taskId: id,
          occurrenceDate: date,
          status: 'missed',
          completedAt: null,
          createdAt: this.state.now(),
        };
        this.state.occurrences.set(occurrence.id, occurrence);
      }
    }
    for (const [key, o] of this.state.occurrences) {
      if (o.taskId !== id || o.occurrenceDate < currentDate) continue;
      if (o.occurrenceDate === currentDate) {
        // 当前这一次变成任务本身
        this.state.occurrences.delete(key);
      } else if (o.status !== 'completed' && !checkedDates.has(o.occurrenceDate)) {
        // 以后既没完成、也没勾过子任务的才消失
        this.state.occurrences.delete(key);
      } else if (o.status === 'pending') {
        this.state.occurrences.set(key, { ...o, status: 'missed' });
      }
    }
    // 子任务勾选：以前作为普通任务的归入历史；当前这一次的成为普通任务的勾选
    this.state.archivedChecks.push(
      ...this.state.checks.filter((c) => mine.has(c.subtaskId) && c.occurrenceDate === null),
    );
    this.state.checks = this.state.checks.flatMap((c) => {
      if (!mine.has(c.subtaskId)) return [c];
      if (c.occurrenceDate === null) return [];
      if (c.occurrenceDate === currentDate) return [{ ...c, occurrenceDate: null }];
      return [c];
    });
    const stopped: Task = {
      ...task,
      recurrenceRule: null,
      recurrenceStartOn: null,
      deadlineOn: currentDate,
      completedAt: null,
      confirmedAt: null,
      updatedAt: this.state.now(),
    };
    this.state.tasks.set(id, stopped);
    return stopped;
  }
}

class MemoryCategoryRepository implements ICategoryRepository {
  constructor(private readonly state: MemoryState) {}

  async list() {
    return [...this.state.categories.values()].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
  }

  async create(input: NewCategory) {
    input = validateCategoryInput(input);
    const category: Category = {
      id: this.state.newId(),
      ownerId: this.state.ownerId,
      name: input.name,
      color: normalizeColor(input.color),
      description: input.description ?? '',
      tools: [...(input.tools ?? [])],
      createdAt: this.state.now(),
    };
    this.state.categories.set(category.id, category);
    return category;
  }

  async update(id: string, patch: CategoryPatch) {
    patch = validateCategoryInput(patch);
    const existing = this.state.categories.get(id) ?? notFound('分类', id);
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
      .sort((a, b) =>
        a.occurrenceDate < b.occurrenceDate ? -1 : a.occurrenceDate > b.occurrenceDate ? 1 : 0,
      );
  }

  async setStatus(id: string, status: OccurrenceStatus, completedAt: Date | null) {
    const existing = this.state.occurrences.get(id) ?? notFound('循环实例', id);
    const updated: RecurrenceOccurrence = { ...existing, status, completedAt };
    this.state.occurrences.set(id, updated);
    return updated;
  }

  async setStatusByDate(
    taskId: string,
    occurrenceDate: string,
    status: OccurrenceStatus,
    completedAt: Date | null,
  ) {
    const existing = (await this.listByTask(taskId)).find(
      (o) => o.occurrenceDate === occurrenceDate,
    );
    if (existing) return this.setStatus(existing.id, status, completedAt);
    const occurrence: RecurrenceOccurrence = {
      id: this.state.newId(),
      taskId,
      occurrenceDate,
      status,
      completedAt,
      createdAt: this.state.now(),
    };
    this.state.occurrences.set(occurrence.id, occurrence);
    return occurrence;
  }

  async applyReconcile(taskId: string, result: ReconcileResult) {
    const existingDates = new Set((await this.listByTask(taskId)).map((o) => o.occurrenceDate));
    for (const { occurrenceDate, status } of result.toCreate) {
      if (existingDates.has(occurrenceDate)) continue;
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

class MemoryTaskPeopleRepository implements ITaskPeopleRepository {
  constructor(private readonly state: MemoryState) {}

  async listByTask(taskId: string) {
    return (
      [...this.state.people.values()]
        .filter((p) => p.taskId === taskId)
        // Map 按插入顺序迭代，排序稳定：同一时刻添加的人物保持添加顺序
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    );
  }

  async replace(taskId: string, drafts: readonly TaskPersonDraft[]) {
    if (!this.state.tasks.has(taskId)) notFound('任务', taskId);
    const people = validatePeopleDrafts(drafts);
    const keep = new Set(people.flatMap((p) => (p.id ? [p.id] : [])));
    for (const person of await this.listByTask(taskId)) {
      if (!keep.has(person.id)) this.state.people.delete(person.id);
    }
    for (const draft of people) {
      const existing = draft.id ? this.state.people.get(draft.id) : undefined;
      if (existing && existing.taskId === taskId) {
        this.state.people.set(existing.id, {
          ...existing,
          name: draft.name,
          note: draft.note,
        });
      } else {
        const person: TaskPerson = {
          id: this.state.newId(),
          taskId,
          name: draft.name,
          note: draft.note,
          contactId: null,
          createdAt: this.state.now(),
        };
        this.state.people.set(person.id, person);
      }
    }
    return this.listByTask(taskId);
  }
}

export interface InMemoryLocalStoreOptions {
  /** 数据所有者：当前登录用户的 id */
  ownerId: string;
  now?: () => Date;
  newId?: () => string;
}

/** 本地存储里的任务关系：算出这条任务自己的日期（只有一个人，不做级联） */
class MemoryRelationRepository implements IRelationRepository {
  private relations: TaskRelation[] = [];

  constructor(private readonly state: MemoryState) {}

  async listForTasks(taskIds: readonly string[]) {
    return this.relations.filter((r) => taskIds.includes(r.taskId));
  }

  async setSchedule(taskId: string, input: ScheduleInput) {
    const task = this.state.tasks.get(taskId) ?? notFound('任务', taskId);
    const others = this.relations.filter((r) => r.taskId !== taskId);
    const next: TaskRelation[] = [];
    for (const [side, list] of [
      ['start', input.startRelations],
      ['end', input.endRelations],
    ] as const) {
      for (const ref of list) {
        if (wouldCreateCycle([...others, ...next], taskId, ref.predecessorId)) {
          throw new DataError('invalid', '任务关系不能形成循环');
        }
        next.push({ ...ref, taskId, side });
      }
    }
    this.relations = [...others, ...next];
    const datesOf = (id: string) => {
      const t = this.state.tasks.get(id);
      if (!t) return undefined;
      return { start: t.startOn, end: t.deadlineOn };
    };
    const dates = computeScheduleDates(
      {
        startOn: input.startOn,
        startRelations: input.startRelations,
        endMode:
          input.endAfterDays !== null
            ? 'after_start'
            : input.endRelations.length > 0
              ? 'relations'
              : 'date',
        endOn: task.deadlineOn,
        endAfterDays: input.endAfterDays,
        endRelations: input.endRelations,
      },
      datesOf,
    );
    const updated: Task = {
      ...task,
      startOn: dates.start,
      endAfterDays: input.endAfterDays,
      deadlineOn:
        input.endAfterDays === null && input.endRelations.length === 0
          ? task.deadlineOn
          : dates.end,
      updatedAt: this.state.now(),
    };
    this.state.tasks.set(taskId, updated);
    return updated;
  }
}

/** 本地存储里的子任务（只有一个人，权限不检查） */
class MemorySubtaskRepository implements ISubtaskRepository {
  constructor(private readonly state: MemoryState) {}

  private get subtasks() {
    return this.state.subtasks;
  }

  async listForTasks(taskIds: readonly string[]) {
    const subtasks = this.subtasks.filter((s) => taskIds.includes(s.taskId));
    const ids = new Set(subtasks.map((s) => s.id));
    return { subtasks, checks: this.state.checks.filter((c) => ids.has(c.subtaskId)) };
  }

  async setList(taskId: string, items: readonly SubtaskDraft[]) {
    const now = this.state.now();
    const keep = new Set<string>();
    items
      .filter((item) => item.title.trim())
      .forEach((item, position) => {
        const existing = item.id
          ? this.subtasks.find((s) => s.id === item.id && s.taskId === taskId && !s.deletedAt)
          : undefined;
        if (existing) {
          existing.title = item.title.trim();
          existing.position = position;
          keep.add(existing.id);
        } else {
          const created: Subtask = {
            id: this.state.newId(),
            taskId,
            title: item.title.trim(),
            position,
            createdAt: now,
            deletedAt: null,
          };
          this.subtasks.push(created);
          keep.add(created.id);
        }
      });
    for (const s of this.subtasks) {
      if (s.taskId === taskId && !s.deletedAt && !keep.has(s.id)) s.deletedAt = now;
    }
    return this.subtasks
      .filter((s) => s.taskId === taskId && !s.deletedAt)
      .sort((a, b) => a.position - b.position);
  }

  async setChecked(subtaskId: string, occurrenceDate: string | null, checked: boolean) {
    const same = (c: SubtaskCheck) =>
      c.subtaskId === subtaskId && c.occurrenceDate === occurrenceDate;
    this.state.checks = this.state.checks.filter((c) => !same(c));
    if (checked) this.state.checks.push({ subtaskId, occurrenceDate });
  }
}

/** 本地存储里的账号设置 */
class MemoryUserSettingsRepository implements IUserSettingsRepository {
  private matrixFilter: unknown = null;

  async getMatrixFilter() {
    return this.matrixFilter;
  }

  async setMatrixFilter(filter: unknown) {
    this.matrixFilter = filter;
  }
}

export class InMemoryLocalStore implements ILocalStore {
  readonly kind = 'local' as const;
  readonly tasks: ITaskRepository;
  readonly categories: ICategoryRepository;
  readonly occurrences: IOccurrenceRepository;
  readonly people: ITaskPeopleRepository;
  readonly groups: IGroupRepository;
  readonly projects: IProjectRepository;
  readonly assignments: IAssignmentRepository;
  readonly relations: IRelationRepository;
  readonly subtasks: ISubtaskRepository;
  readonly settings: IUserSettingsRepository;

  constructor(options: InMemoryLocalStoreOptions) {
    const state: MemoryState = {
      ownerId: options.ownerId,
      now: options.now ?? (() => new Date()),
      newId: options.newId ?? (() => crypto.randomUUID()),
      tasks: new Map(),
      categories: new Map(),
      taskCategories: new Set(),
      occurrences: new Map(),
      people: new Map(),
      projects: new Map(),
      subtasks: [],
      checks: [],
      archivedChecks: [],
    };
    this.tasks = new MemoryTaskRepository(state);
    this.categories = new MemoryCategoryRepository(state);
    this.occurrences = new MemoryOccurrenceRepository(state);
    this.people = new MemoryTaskPeopleRepository(state);
    this.groups = new MemoryGroupRepository(state);
    this.projects = new MemoryProjectRepository(state);
    this.assignments = new MemoryAssignmentRepository();
    this.relations = new MemoryRelationRepository(state);
    this.subtasks = new MemorySubtaskRepository(state);
    this.settings = new MemoryUserSettingsRepository();
  }
}
