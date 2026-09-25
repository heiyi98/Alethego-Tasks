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
 * owner_id 由存储实现在构造时确定（未登录阶段为固定值 LOCAL_OWNER_ID），接口中不出现。
 */

export interface TaskListQuery {
  /** 分类筛选：命中其一即返回（逻辑或）；不传或为空表示不筛选 */
  categoryIds?: readonly string[];
}

/** 快速添加只需 title；其余字段可省略，之后在详情中通过 update 补充。 */
export interface NewTask {
  /** 会去除首尾空白；为空白时抛出 DataError('invalid') */
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

/**
 * 任务仓储。已软删除的任务对 list / getById / update 均不可见。
 */
export interface ITaskRepository {
  /**
   * 默认按截止时间从近到远排序，无截止时间的排最后（同 core 的 compareByDeadline）。
   * 循环任务的排序依据是代表实例，需上层用 listDeadlineOf + sortByDeadline 重新排序。
   */
  list(query?: TaskListQuery): Promise<Task[]>;
  getById(id: string): Promise<Task | null>;
  /** 快速添加：只需标题即可创建 */
  create(input: NewTask): Promise<Task>;
  update(id: string, patch: TaskPatch): Promise<Task>;
  /** 软删除：写入 deleted_at，数据（含分类关联、循环实例记录）保留；重复删除无副作用 */
  delete(id: string): Promise<void>;
  /** 撤销软删除 */
  restore(id: string): Promise<Task>;
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
  /**
   * 按实例时间设置状态：记录不存在时新建（例如提前完成一个尚未到来的实例），存在时更新。
   */
  setStatusByDate(
    taskId: string,
    occurrenceDate: Date,
    status: OccurrenceStatus,
    completedAt: Date | null,
  ): Promise<RecurrenceOccurrence>;
  /** 落库 RecurrenceEngine.reconcileOccurrences 的判定结果（重复记录会被忽略） */
  applyReconcile(taskId: string, result: ReconcileResult): Promise<void>;
}
