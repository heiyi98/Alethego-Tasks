import type {
  Category,
  ImportanceLevel,
  OccurrenceStatus,
  ReconcileResult,
  RecurrenceOccurrence,
  Task,
} from '@alethego/core';

/**
 * 仓储接口：上层业务代码只依赖这些窄接口，不感知背后是 Supabase、本地存储还是同步队列。
 * owner_id 由数据库按当前登录用户（auth.uid()）自动填充，接口中不出现。
 */

export interface TaskListQuery {
  /** 分类筛选：命中其一即返回（逻辑或）；不传或为空表示不筛选 */
  categoryIds?: readonly string[];
}

export interface NewTask {
  title: string;
  description?: string;
  deadlineAt?: Date | null;
  importanceLevel?: ImportanceLevel;
  recurrenceRule?: string | null;
  recurrenceDtstart?: Date | null;
}

export type TaskPatch = Partial<
  Pick<
    Task,
    | 'title'
    | 'description'
    | 'deadlineAt'
    | 'importanceLevel'
    | 'recurrenceRule'
    | 'recurrenceDtstart'
    | 'completedAt'
  >
>;

export interface ITaskRepository {
  list(query?: TaskListQuery): Promise<Task[]>;
  getById(id: string): Promise<Task | null>;
  create(input: NewTask): Promise<Task>;
  update(id: string, patch: TaskPatch): Promise<Task>;
  /** 同时级联删除该任务的分类关联与循环实例记录 */
  delete(id: string): Promise<void>;
}

export interface NewCategory {
  name: string;
  /** #RRGGBB，在同一用户的分类内不可重复 */
  color: string;
}

export type CategoryPatch = Partial<NewCategory>;

export interface ICategoryRepository {
  list(): Promise<Category[]>;
  create(input: NewCategory): Promise<Category>;
  update(id: string, patch: CategoryPatch): Promise<Category>;
  /** 只解除任务关联，任务本体不受影响 */
  delete(id: string): Promise<void>;
  /** taskId → 该任务挂的分类 id 列表 */
  listCategoryIdsByTask(taskIds: readonly string[]): Promise<Map<string, string[]>>;
  /** 将任务的分类整体替换为给定集合 */
  setTaskCategories(taskId: string, categoryIds: readonly string[]): Promise<void>;
}

export interface IOccurrenceRepository {
  listByTask(taskId: string): Promise<RecurrenceOccurrence[]>;
  /** 用户手动修改某次实例的完成状态 */
  setStatus(
    id: string,
    status: OccurrenceStatus,
    completedAt: Date | null,
  ): Promise<RecurrenceOccurrence>;
  /** 落库 RecurrenceEngine.reconcileOccurrences 的判定结果（重复记录会被忽略） */
  applyReconcile(taskId: string, result: ReconcileResult): Promise<void>;
}
