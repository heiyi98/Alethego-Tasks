import type {
  ICategoryRepository,
  IGroupRepository,
  IOccurrenceRepository,
  ITaskLocationRepository,
  ITaskPeopleRepository,
  ITaskRepository,
} from './repositories';

/** 一组数据存取能力。本地与远程存储各自实现同一形状。 */
export interface DataStore {
  tasks: ITaskRepository;
  categories: ICategoryRepository;
  occurrences: IOccurrenceRepository;
  /** 任务详情扩展：地点 / 人物（由 TaskDetailAggregator 统一拼装） */
  locations: ITaskLocationRepository;
  people: ITaskPeopleRepository;
  /** 组：名单、邀请、删除组的投票、通知 */
  groups: IGroupRepository;
}

/** 只管与 Supabase 通信。 */
export interface IRemoteStore extends DataStore {
  readonly kind: 'remote';
}

/**
 * 只管本地读写（Web: IndexedDB；移动端: SQLite）。
 * 离线同步所需的待同步队列等能力会在实现 SyncEngine 时补充到这里。
 */
export interface ILocalStore extends DataStore {
  readonly kind: 'local';
}
