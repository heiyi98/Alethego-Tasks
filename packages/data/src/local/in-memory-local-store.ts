import {
  compareByDeadline,
  computeScheduleDates,
  dateOfInstant,
  endOfDate,
  wouldCreateCycle,
  type TaskRelation,
  normalizeColor,
  normalizeLocationDraft,
  type TaskLocation,
  type TaskLocationDraft,
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
  ITaskLocationRepository,
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
  locations: Map<string, TaskLocation>;
  people: Map<string, TaskPerson>;
  projects: Map<string, Project>;
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
      deadlineAt: valid.deadlineAt ?? null,
      importanceLevel: valid.importanceLevel ?? 0,
      recurrenceRule: valid.recurrenceRule ?? null,
      recurrenceDtstart: valid.recurrenceDtstart ?? null,
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
      .sort((a, b) => a.occurrenceDate.getTime() - b.occurrenceDate.getTime());
  }

  async setStatus(id: string, status: OccurrenceStatus, completedAt: Date | null) {
    const existing = this.state.occurrences.get(id) ?? notFound('循环实例', id);
    const updated: RecurrenceOccurrence = { ...existing, status, completedAt };
    this.state.occurrences.set(id, updated);
    return updated;
  }

  async setStatusByDate(
    taskId: string,
    occurrenceDate: Date,
    status: OccurrenceStatus,
    completedAt: Date | null,
  ) {
    const existing = (await this.listByTask(taskId)).find(
      (o) => o.occurrenceDate.getTime() === occurrenceDate.getTime(),
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

class MemoryTaskLocationRepository implements ITaskLocationRepository {
  constructor(private readonly state: MemoryState) {}

  async getByTask(taskId: string) {
    return this.state.locations.get(taskId) ?? null;
  }

  async set(taskId: string, draft: TaskLocationDraft | null) {
    if (!this.state.tasks.has(taskId)) notFound('任务', taskId);
    const location = draft ? normalizeLocationDraft(draft) : null;
    if (!location) {
      this.state.locations.delete(taskId);
      return null;
    }
    const existing = this.state.locations.get(taskId);
    const next: TaskLocation = existing
      ? { ...existing, ...location }
      : { taskId, ...location, placeId: null, lat: null, lng: null };
    this.state.locations.set(taskId, next);
    return next;
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
          relation: draft.relation,
        });
      } else {
        const person: TaskPerson = {
          id: this.state.newId(),
          taskId,
          name: draft.name,
          relation: draft.relation,
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
    const zone = input.dateZone;
    const datesOf = (id: string) => {
      const t = this.state.tasks.get(id);
      if (!t) return undefined;
      return { start: t.startOn, end: t.deadlineAt ? dateOfInstant(t.deadlineAt, zone) : null };
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
        endOn: task.deadlineAt ? dateOfInstant(task.deadlineAt, zone) : null,
        endAfterDays: input.endAfterDays,
        endRelations: input.endRelations,
      },
      datesOf,
    );
    const updated: Task = {
      ...task,
      startOn: dates.start,
      endAfterDays: input.endAfterDays,
      deadlineAt:
        input.endAfterDays === null && input.endRelations.length === 0
          ? task.deadlineAt
          : dates.end
            ? endOfDate(dates.end, zone)
            : null,
      updatedAt: this.state.now(),
    };
    this.state.tasks.set(taskId, updated);
    return updated;
  }
}

/** 本地存储里的子任务（只有一个人，权限不检查） */
class MemorySubtaskRepository implements ISubtaskRepository {
  private subtasks: Subtask[] = [];
  private checks: SubtaskCheck[] = [];

  constructor(private readonly state: MemoryState) {}

  async listForTasks(taskIds: readonly string[]) {
    const subtasks = this.subtasks.filter((s) => taskIds.includes(s.taskId));
    const ids = new Set(subtasks.map((s) => s.id));
    return { subtasks, checks: this.checks.filter((c) => ids.has(c.subtaskId)) };
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

  async setChecked(subtaskId: string, occurrenceDate: Date | null, checked: boolean) {
    const same = (c: SubtaskCheck) =>
      c.subtaskId === subtaskId &&
      (c.occurrenceDate?.getTime() ?? null) === (occurrenceDate?.getTime() ?? null);
    this.checks = this.checks.filter((c) => !same(c));
    if (checked) this.checks.push({ subtaskId, occurrenceDate });
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
  readonly locations: ITaskLocationRepository;
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
      locations: new Map(),
      people: new Map(),
      projects: new Map(),
    };
    this.tasks = new MemoryTaskRepository(state);
    this.categories = new MemoryCategoryRepository(state);
    this.occurrences = new MemoryOccurrenceRepository(state);
    this.locations = new MemoryTaskLocationRepository(state);
    this.people = new MemoryTaskPeopleRepository(state);
    this.groups = new MemoryGroupRepository(state);
    this.projects = new MemoryProjectRepository(state);
    this.assignments = new MemoryAssignmentRepository();
    this.relations = new MemoryRelationRepository(state);
    this.subtasks = new MemorySubtaskRepository(state);
    this.settings = new MemoryUserSettingsRepository();
  }
}
