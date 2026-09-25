import type { ICategoryRepository, IOccurrenceRepository, ITaskRepository } from './repositories';

/** 一组数据存取能力。本地与远程存储各自实现同一形状。 */
export interface DataStore {
  tasks: ITaskRepository;
  categories: ICategoryRepository;
  occurrences: IOccurrenceRepository;
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
