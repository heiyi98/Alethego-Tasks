import type {
  Group,
  GroupKind,
  GroupMember,
  Project,
  ProjectContact,
  ProjectMember,
  Task,
  TaskAssignment,
} from '@alethego/core';

import { DataError } from '../errors';
import type {
  DeletionRequestResult,
  DeletionVoteResult,
  GroupDeletionRequest,
  AssignmentDraft,
  GroupNotification,
  IAssignmentRepository,
  IGroupRepository,
  IProjectRepository,
  InviteResult,
  NewProject,
  ProjectDeletionRequest,
  ProjectInviteResult,
  LeaderRequest,
  LeaveResult,
  MemberTaskRole,
} from '../interfaces/repositories';

interface MemoryGroupState {
  ownerId: string;
  now: () => Date;
  newId: () => string;
  tasks: Map<string, Task>;
  projects: Map<string, Project>;
}

/**
 * 本地存储里的组：只有本机这一个用户，所以名单只有自己、没有通知；
 * 删除组时只有自己一人，直接删除（连同组里的任务）。
 */
export class MemoryGroupRepository implements IGroupRepository {
  private readonly groups = new Map<string, Group>();
  private readonly nicknames = new Map<string, string | null>();
  private readonly invitations = new Map<string, Set<string>>();
  private seenAt: Date | null = null;

  constructor(private readonly state: MemoryGroupState) {}

  async list() {
    return [...this.groups.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async create(input: { name: string; kind: GroupKind; color: string | null }) {
    const trimmed = input.name.trim();
    if (!trimmed) throw new DataError('invalid', '组名不能为空');
    const group: Group = {
      id: this.state.newId(),
      kind: input.kind,
      name: trimmed,
      color: input.color,
      createdBy: this.state.ownerId,
      createdAt: this.state.now(),
      myRole: 'leader',
    };
    this.groups.set(group.id, group);
    return group;
  }

  async update(groupId: string, input: { name: string; color: string | null }) {
    const trimmed = input.name.trim();
    if (!trimmed) throw new DataError('invalid', '组名不能为空');
    const group = { ...this.group(groupId), name: trimmed, color: input.color };
    this.groups.set(groupId, group);
    return group;
  }

  private group(groupId: string): Group {
    const group = this.groups.get(groupId);
    if (!group) throw new DataError('not_found', `组 ${groupId} 不存在`);
    return group;
  }

  async roster(groupId: string): Promise<GroupMember[]> {
    const group = this.group(groupId);
    const nickname = this.nicknames.get(groupId) ?? null;
    return [
      {
        userId: this.state.ownerId,
        nickname: nickname ?? '我',
        hasCustomNickname: nickname !== null,
        isMe: true,
        joinedAt: group.createdAt,
        role: 'leader',
        email: '',
      },
    ];
  }

  async setNickname(groupId: string, nickname: string | null) {
    this.group(groupId);
    this.nicknames.set(groupId, nickname?.trim() || null);
  }

  async invite(groupId: string, email: string): Promise<InviteResult> {
    this.group(groupId);
    const set = this.invitations.get(groupId) ?? new Set<string>();
    const normalized = email.trim().toLowerCase();
    if (set.has(normalized)) return 'already_invited';
    set.add(normalized);
    this.invitations.set(groupId, set);
    return 'invited';
  }

  async notifications(): Promise<{ items: GroupNotification[]; seenAt: Date | null }> {
    return { items: [], seenAt: this.seenAt };
  }

  async markNotificationsSeen() {
    this.seenAt = this.state.now();
    return this.seenAt;
  }

  async acceptInvitation(invitationId: string): Promise<string> {
    throw new DataError('not_found', `邀请 ${invitationId} 不存在`);
  }

  async declineInvitation() {}

  async deletionRequest(): Promise<GroupDeletionRequest | null> {
    return null;
  }

  async requestDeletion(groupId: string): Promise<DeletionRequestResult> {
    this.group(groupId);
    // 组里只有自己一人：直接删除，连同组里的全部任务
    this.groups.delete(groupId);
    for (const [id, project] of this.state.projects) {
      if (project.groupId === groupId) this.state.projects.delete(id);
    }
    for (const [id, task] of this.state.tasks) {
      if (task.groupId === groupId) this.state.tasks.delete(id);
    }
    return 'deleted';
  }

  async voteDeletion(): Promise<DeletionVoteResult> {
    return 'no_request';
  }

  async processTimeouts() {
    return 0;
  }

  // 只有自己一个人：没有别的成员可以任命、踢出
  async leaderRequests(): Promise<LeaderRequest[]> {
    return [];
  }

  async requestLeader(): Promise<'appointed'> {
    throw new DataError('invalid', '组里没有别的成员');
  }

  async voteLeader(): Promise<'no_request'> {
    return 'no_request';
  }

  async memberTaskRoles(): Promise<MemberTaskRole[]> {
    return [];
  }

  async removeMember(): Promise<'removed'> {
    throw new DataError('invalid', '组里没有别的成员');
  }

  async leave(groupId: string): Promise<LeaveResult> {
    const group = this.group(groupId);
    // 管理组：唯一的组长不能退出；合作组：最后一个成员退出，组和任务一起删除
    if (group.kind === 'management') return 'last_leader';
    await this.requestDeletion(groupId);
    return 'deleted';
  }

  async dismissNotification() {}
}

/** 本地存储里的项目：只有本机这一个用户（组长），名单只有自己 */
export class MemoryProjectRepository implements IProjectRepository {
  private readonly contactList = new Map<string, ProjectContact>();

  constructor(private readonly state: MemoryGroupState) {}

  async list() {
    return [...this.state.projects.values()];
  }

  async create(input: NewProject) {
    const trimmed = input.name.trim();
    if (!trimmed) throw new DataError('invalid', '项目名不能为空');
    const project: Project = {
      id: this.state.newId(),
      groupId: input.groupId,
      name: trimmed,
      color: input.color,
      tools: [...new Set(input.tools)].sort(),
      createdBy: this.state.ownerId,
      createdAt: this.state.now(),
      myRole: 'leader',
    };
    this.state.projects.set(project.id, project);
    return project;
  }

  private project(projectId: string): Project {
    const project = this.state.projects.get(projectId);
    if (!project) throw new DataError('not_found', `项目 ${projectId} 不存在`);
    return project;
  }

  async update(projectId: string, input: { name: string; color: string }) {
    const trimmed = input.name.trim();
    if (!trimmed) throw new DataError('invalid', '项目名不能为空');
    const project = { ...this.project(projectId), name: trimmed, color: input.color };
    this.state.projects.set(projectId, project);
    return project;
  }

  async roster(projectId: string): Promise<ProjectMember[]> {
    const project = this.project(projectId);
    return [
      {
        userId: this.state.ownerId,
        nickname: '我',
        isMe: true,
        role: 'leader',
        email: '',
        inGroup: true,
        joinedAt: project.createdAt,
      },
    ];
  }

  async addMember(): Promise<void> {
    throw new DataError('invalid', '组里没有别的成员');
  }

  async invite(projectId: string): Promise<ProjectInviteResult> {
    this.project(projectId);
    return 'invited';
  }

  async acceptInvitation(invitationId: string): Promise<string> {
    throw new DataError('not_found', `邀请 ${invitationId} 不存在`);
  }

  async declineInvitation() {}

  async setRole(): Promise<void> {
    throw new DataError('invalid', '项目里没有别的成员');
  }

  async memberTaskRoles(): Promise<MemberTaskRole[]> {
    return [];
  }

  async removeMember(): Promise<'removed'> {
    throw new DataError('invalid', '项目里没有别的成员');
  }

  async leave(): Promise<'left'> {
    throw new DataError('invalid', '组长不能退出项目');
  }

  async contacts(projectId: string): Promise<ProjectContact[]> {
    this.project(projectId);
    return [...this.contactList.values()].filter((c) => c.projectId === projectId);
  }

  async addContact(projectId: string, name: string): Promise<ProjectContact> {
    this.project(projectId);
    const contact = { id: this.state.newId(), projectId, name: name.trim() };
    this.contactList.set(contact.id, contact);
    return contact;
  }

  async removeContact(contactId: string) {
    this.contactList.delete(contactId);
  }

  async deletionRequest(): Promise<ProjectDeletionRequest | null> {
    return null;
  }

  async requestDeletion(projectId: string): Promise<DeletionRequestResult> {
    this.project(projectId);
    // 组里只有自己一位组长：直接删除，连同项目里的全部任务
    this.state.projects.delete(projectId);
    for (const [id, task] of this.state.tasks) {
      if (task.projectId === projectId) this.state.tasks.delete(id);
    }
    return 'deleted';
  }

  async voteDeletion(): Promise<DeletionVoteResult> {
    return 'no_request';
  }
}

/** 本地存储里的 RACI */
export class MemoryAssignmentRepository implements IAssignmentRepository {
  private readonly byTask = new Map<string, TaskAssignment[]>();

  async listForTasks(taskIds: readonly string[]) {
    return taskIds.flatMap((id) => this.byTask.get(id) ?? []);
  }

  async set(taskId: string, assignments: readonly AssignmentDraft[]) {
    this.byTask.set(
      taskId,
      assignments.map((a) => ({ ...a, taskId })),
    );
  }
}
