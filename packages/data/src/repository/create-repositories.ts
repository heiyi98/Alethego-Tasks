import type { DataStore, ILocalStore, IRemoteStore } from '../interfaces/stores';

export interface RepositoryDependencies {
  remote: IRemoteStore;
  /** 离线存储；SyncEngine 实现前暂不参与读写 */
  local?: ILocalStore;
}

/**
 * 对上层统一暴露的仓储入口。上层只拿到 ITaskRepository 等接口，不感知背后的存储。
 *
 * MVP 阶段直接使用远程存储；实现 Offline-First 时，在这里组合 local + remote + SyncEngine
 * （先写本地、入同步队列，联网后按 updated_at 做 Last-Write-Wins），上层代码无需改动。
 */
export function createRepositories({ remote }: RepositoryDependencies): DataStore {
  return {
    tasks: remote.tasks,
    categories: remote.categories,
    occurrences: remote.occurrences,
  };
}
