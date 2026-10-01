import type { Group, GroupMember, Task } from '@alethego/core';

import { DataError } from '../errors';
import type {
  DeletionRequestResult,
  DeletionVoteResult,
  GroupDeletionRequest,
  GroupNotification,
  IGroupRepository,
  InviteResult,
} from '../interfaces/repositories';

interface MemoryGroupState {
  ownerId: string;
  now: () => Date;
  newId: () => string;
  tasks: Map<string, Task>;
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

  async create(name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new DataError('invalid', '组名不能为空');
    const group: Group = {
      id: this.state.newId(),
      kind: 'cooperative',
      name: trimmed,
      createdBy: this.state.ownerId,
      createdAt: this.state.now(),
    };
    this.groups.set(group.id, group);
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
    for (const [id, task] of this.state.tasks) {
      if (task.groupId === groupId) this.state.tasks.delete(id);
    }
    return 'deleted';
  }

  async voteDeletion(): Promise<DeletionVoteResult> {
    return 'no_request';
  }

  async processExpiredDeletions() {
    return 0;
  }
}
