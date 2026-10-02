'use client';

import {
  GROUP_KIND_CONFIG,
  PERSONAL_FEATURES,
  featuresForGroupPage,
  featuresForProject,
  groupPermissions,
  projectPermissions,
  type ContainerFeatures,
  type Group,
  type GroupMember,
  type GroupPermissions,
  type Project,
  type ProjectContact,
  type ProjectMember,
  type ProjectPermissions,
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

/** 一个项目里的情况：开了哪些功能、我的权限、项目名单（成员 + 只有名字的人） */
export interface ProjectScope {
  project: Project;
  features: ContainerFeatures;
  permissions: ProjectPermissions;
  members: ProjectMember[];
  contacts: ProjectContact[];
  me: ProjectMember | undefined;
}

/**
 * 当前所在的容器：个人、某个组（列出我能看到的所有项目的任务）或组里的某个项目。
 * 页面层面开了哪些功能（见 core 的 featuresForProject / featuresForGroupPage）、组名单、
 * 每个项目的名单和权限都从这里取；一条任务按它所属的项目取 scopeOf(task.projectId)。
 */
export interface CurrentGroupValue {
  group: Group | null;
  /** 选中的项目；null = 个人或整个组 */
  project: Project | null;
  /** 当前组里我能看到的项目 */
  projects: Project[];
  /** 页面层面的功能 */
  features: ContainerFeatures;
  /** 我在组里的权限 */
  permissions: GroupPermissions | null;
  /** 组名单（只在项目里的人看不到，为空） */
  members: GroupMember[];
  leaderRequests: LeaderRequest[];
  /** 某个项目的情况；个人任务（null）或还没加载时为 null */
  scopeOf: (projectId: string | null) => ProjectScope | null;
  /** 名单是否已加载（个人容器始终为 true） */
  rosterLoaded: boolean;
  reloadRoster: () => Promise<void>;
}

const CurrentGroupContext = createContext<CurrentGroupValue | null>(null);

interface Rosters {
  groupId: string;
  members: GroupMember[];
  leaderRequests: LeaderRequest[];
  projects: Map<string, { members: ProjectMember[]; contacts: ProjectContact[] }>;
}

export function CurrentGroupProvider({ children }: { children: ReactNode }) {
  const repositories = useRepositories();
  const { data } = useTaskData();
  const { groupId, projectId } = useSelection();
  const group = groupId ? (data?.groups.find((g) => g.id === groupId) ?? null) : null;
  const projects = useMemo(
    () => (group ? (data?.projects.filter((p) => p.groupId === group.id) ?? []) : []),
    [data, group],
  );
  const project = projectId ? (projects.find((p) => p.id === projectId) ?? null) : null;
  const [rosters, setRosters] = useState<Rosters | null>(null);

  const load = useCallback(async () => {
    if (!group) return;
    try {
      const config = GROUP_KIND_CONFIG[group.kind];
      const [members, leaderRequests, projectRosters] = await Promise.all([
        group.myRole ? repositories.groups.roster(group.id) : Promise.resolve([]),
        group.myRole && config.leaderVoteDays !== null
          ? repositories.groups.leaderRequests(group.id)
          : Promise.resolve([]),
        Promise.all(
          projects.map(async (p) => {
            const [projectMembers, contacts] = await Promise.all([
              repositories.projects.roster(p.id),
              featuresForProject(p).contacts
                ? repositories.projects.contacts(p.id)
                : Promise.resolve([]),
            ]);
            return [p.id, { members: projectMembers, contacts }] as const;
          }),
        ),
      ]);
      setRosters({ groupId: group.id, members, leaderRequests, projects: new Map(projectRosters) });
    } catch {
      // 刚被移出组等情况：名单留空，页面会回到总览
    }
  }, [repositories, group, projects]);

  // 组变了、或者数据重新加载过（身份、项目可能变了）时刷新名单
  useEffect(() => {
    void load();
  }, [load, data]);

  const value = useMemo<CurrentGroupValue>(() => {
    const current = rosters && group && rosters.groupId === group.id ? rosters : null;
    const scopeOf = (id: string | null): ProjectScope | null => {
      if (!id || !group) return null;
      const p = projects.find((x) => x.id === id);
      if (!p) return null;
      const roster = current?.projects.get(id);
      return {
        project: p,
        features: featuresForProject(p),
        permissions: projectPermissions(group.kind, p),
        members: roster?.members ?? [],
        contacts: roster?.contacts ?? [],
        me: roster?.members.find((m) => m.isMe),
      };
    };
    return {
      group,
      project,
      projects,
      features: !group
        ? PERSONAL_FEATURES
        : project
          ? featuresForProject(project)
          : featuresForGroupPage(projects),
      permissions: group ? groupPermissions(group.kind, group.myRole) : null,
      members: current?.members ?? [],
      leaderRequests: current?.leaderRequests ?? [],
      scopeOf,
      rosterLoaded: !group || current !== null,
      reloadRoster: load,
    };
  }, [group, project, projects, rosters, load]);

  return <CurrentGroupContext.Provider value={value}>{children}</CurrentGroupContext.Provider>;
}

export function useCurrentGroup(): CurrentGroupValue {
  const value = useContext(CurrentGroupContext);
  if (!value) throw new Error('useCurrentGroup 必须在 CurrentGroupProvider 内使用');
  return value;
}

/** 名单里某人在本组显示的名字：成员用昵称，只有名字的人用名字 */
export function personName(
  members: readonly Pick<ProjectMember, 'userId' | 'nickname'>[],
  contacts: readonly ProjectContact[],
  target: { userId: string | null; contactId: string | null },
): string {
  if (target.userId) return members.find((m) => m.userId === target.userId)?.nickname ?? '';
  return contacts.find((c) => c.id === target.contactId)?.name ?? '';
}
