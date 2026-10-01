'use client';

import {
  CONTAINER_FEATURES,
  containerKindOf,
  groupPermissions,
  type ContainerFeatures,
  type ContainerKind,
  type Group,
  type GroupContact,
  type GroupMember,
  type GroupPermissions,
} from '@alethego/core';
import type { LeaderRequest } from '@alethego/data';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useRepositories } from './repositories-provider';
import { useSelection } from './selection';
import { useTaskData } from './task-data-provider';

/**
 * 当前所在的容器（个人或某一个组）：它开了哪些功能（见 core 的 CONTAINER_FEATURES）、
 * 我在里面的权限，以及组的名单（成员 + 只有名字的人）。各看法、标题栏、任务面板都从这里取。
 */
export interface CurrentGroupValue {
  group: Group | null;
  kind: ContainerKind;
  features: ContainerFeatures;
  permissions: GroupPermissions | null;
  members: GroupMember[];
  contacts: GroupContact[];
  leaderRequests: LeaderRequest[];
  me: GroupMember | undefined;
  /** 名单是否已加载（个人容器始终为 true） */
  rosterLoaded: boolean;
  reloadRoster: () => Promise<void>;
}

const CurrentGroupContext = createContext<CurrentGroupValue | null>(null);

interface Roster {
  groupId: string;
  members: GroupMember[];
  contacts: GroupContact[];
  leaderRequests: LeaderRequest[];
}

export function CurrentGroupProvider({ children }: { children: ReactNode }) {
  const repositories = useRepositories();
  const { data } = useTaskData();
  const { groupId } = useSelection();
  const group = groupId ? (data?.groups.find((g) => g.id === groupId) ?? null) : null;
  const [roster, setRoster] = useState<Roster | null>(null);

  const load = useCallback(async () => {
    if (!group) return;
    try {
      const features = CONTAINER_FEATURES[group.kind];
      const [members, contacts, leaderRequests] = await Promise.all([
        repositories.groups.roster(group.id),
        features.contacts ? repositories.groups.contacts(group.id) : Promise.resolve([]),
        features.leaderVoteDays !== null
          ? repositories.groups.leaderRequests(group.id)
          : Promise.resolve([]),
      ]);
      setRoster({ groupId: group.id, members, contacts, leaderRequests });
    } catch {
      // 刚被移出组等情况：名单留空，页面会回到总览
    }
  }, [repositories, group]);

  // 组变了、或者数据重新加载过（身份可能变了）时刷新名单
  useEffect(() => {
    void load();
  }, [load, data]);

  const value = useMemo<CurrentGroupValue>(() => {
    const kind = containerKindOf(group);
    const current = roster && group && roster.groupId === group.id ? roster : null;
    return {
      group,
      kind,
      features: CONTAINER_FEATURES[kind],
      permissions: group ? groupPermissions(group.kind, group.myRole) : null,
      members: current?.members ?? [],
      contacts: current?.contacts ?? [],
      leaderRequests: current?.leaderRequests ?? [],
      me: current?.members.find((m) => m.isMe),
      rosterLoaded: !group || current !== null,
      reloadRoster: load,
    };
  }, [group, roster, load]);

  return <CurrentGroupContext.Provider value={value}>{children}</CurrentGroupContext.Provider>;
}

export function useCurrentGroup(): CurrentGroupValue {
  const value = useContext(CurrentGroupContext);
  if (!value) throw new Error('useCurrentGroup 必须在 CurrentGroupProvider 内使用');
  return value;
}

/** 名单里某人在本组显示的名字：成员用昵称，只有名字的人用名字 */
export function personName(
  members: readonly GroupMember[],
  contacts: readonly GroupContact[],
  target: { userId: string | null; contactId: string | null },
): string {
  if (target.userId) return members.find((m) => m.userId === target.userId)?.nickname ?? '';
  return contacts.find((c) => c.id === target.contactId)?.name ?? '';
}
