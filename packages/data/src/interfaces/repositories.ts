import type {
  Category,
  Group,
  GroupMember,
  ImportanceLevel,
  OccurrenceStatus,
  ReconcileResult,
  RecurrenceOccurrence,
  Task,
  TaskLocation,
  TaskLocationDraft,
  TaskPerson,
  TaskPersonDraft,
} from '@alethego/core';

/**
 * 仓储接口：上层业务代码只依赖这些窄接口，不感知背后是 Supabase、本地存储还是同步队列。
 * owner_id 由存储实现在构造时确定（当前登录用户的 id），接口中不出现。
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
  /** 标星（书签），默认 false；组任务不能标星 */
  isStarred?: boolean;
  /** 所属的组；不传 / null = 个人任务。创建后不能移动到别的容器 */
  groupId?: string | null;
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
    | 'isStarred'
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
  /** #RRGGBB，在同一用户的分类内不可重复（冲突时抛出 DataError('conflict')） */
  color: string;
  description?: string;
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

/** 任务地点（一对一）。tasks 仓储不感知它的存在。 */
export interface ITaskLocationRepository {
  getByTask(taskId: string): Promise<TaskLocation | null>;
  /**
   * 设置地点的本地字段（名称、地址）；传 null 表示删除地点。
   * 只写本地字段，预留的 placeId / 坐标不会被覆盖。名称与地址都为空时等同于删除。
   */
  set(taskId: string, draft: TaskLocationDraft | null): Promise<TaskLocation | null>;
}

/** 任务关联人物（一对多）。 */
export interface ITaskPeopleRepository {
  listByTask(taskId: string): Promise<TaskPerson[]>;
  /**
   * 将任务的人物整体替换为给定列表：带 id 的更新、不带 id 的新增、列表中没有的删除。
   * 完全空白的行会被忽略；只有关系没有姓名时抛出 DataError('invalid')。
   */
  replace(taskId: string, drafts: readonly TaskPersonDraft[]): Promise<TaskPerson[]>;
}

/** 应用内通知：入组邀请、删除组的投票 */
export interface GroupNotification {
  kind: 'group_invitation' | 'group_deletion_vote';
  /** 入组邀请：邀请的 id；删除组的投票：组的 id */
  id: string;
  groupId: string;
  groupName: string;
  /** 邀请人 / 发起删除的人（在那个组里的昵称） */
  actorName: string;
  createdAt: Date;
}

export type InviteResult = 'invited' | 'already_invited' | 'already_member' | 'self';
export type DeletionRequestResult = 'deleted' | 'requested' | 'already_requested';
export type DeletionVoteResult = 'deleted' | 'agreed' | 'cancelled' | 'no_request';

/** 正在进行的删除组投票 */
export interface GroupDeletionRequest {
  groupId: string;
  initiatedBy: string;
  startedAt: Date;
  /** 已经同意的成员（发起者算作同意） */
  agreedUserIds: string[];
}

/**
 * 组：建组、名单与昵称、邀请、删除组的投票、通知。
 * 权限按组的类型在后台生效（见数据库函数），这里只是调用。
 */
export interface IGroupRepository {
  /** 我所在的所有组 */
  list(): Promise<Group[]>;
  /** 建组（合作组），创建者是组长 */
  create(name: string): Promise<Group>;
  roster(groupId: string): Promise<GroupMember[]>;
  /** 设置自己在本组的昵称；null = 恢复成 TaskApp 名字 */
  setNickname(groupId: string, nickname: string | null): Promise<void>;
  invite(groupId: string, email: string): Promise<InviteResult>;
  notifications(): Promise<{ items: GroupNotification[]; seenAt: Date | null }>;
  markNotificationsSeen(): Promise<Date>;
  acceptInvitation(invitationId: string): Promise<string>;
  declineInvitation(invitationId: string): Promise<void>;
  deletionRequest(groupId: string): Promise<GroupDeletionRequest | null>;
  requestDeletion(groupId: string): Promise<DeletionRequestResult>;
  voteDeletion(groupId: string, agree: boolean): Promise<DeletionVoteResult>;
  /** 一周内没有操作的组长算作同意：打开 TaskApp 时检查并执行；返回删除的组数 */
  processExpiredDeletions(): Promise<number>;
}
