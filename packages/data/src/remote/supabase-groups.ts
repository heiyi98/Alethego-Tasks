import type { Group, GroupKind, GroupMember } from '@alethego/core';
import type { PostgrestError } from '@supabase/supabase-js';

import { DataError } from '../errors';
import type {
  DeletionRequestResult,
  DeletionVoteResult,
  GroupDeletionRequest,
  GroupNotification,
  IGroupRepository,
  InviteResult,
} from '../interfaces/repositories';
import type { TableRow } from './database.types';
import type { TaskAppSupabaseClient } from './supabase-client';

function check<T>(result: { data: T | null; error: PostgrestError | null }, action: string): T {
  if (result.error) {
    const code = result.error.code === '42501' ? 'invalid' : 'unknown';
    throw new DataError(code, `${action}失败：${result.error.message}`, { cause: result.error });
  }
  return result.data as T;
}

export function groupFromRow(row: TableRow<'groups'>): Group {
  return {
    id: row.id,
    kind: row.kind as GroupKind,
    name: row.name,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
  };
}

/** 组的存取：写操作都调用数据库函数，函数内按组的类型检查身份 */
export class SupabaseGroupRepository implements IGroupRepository {
  constructor(
    private readonly client: TaskAppSupabaseClient,
    private readonly userId: string,
  ) {}

  async list(): Promise<Group[]> {
    const rows = check(
      await this.client.from('groups').select('*').order('created_at', { ascending: true }),
      '查询组',
    );
    return rows.map(groupFromRow);
  }

  async create(name: string): Promise<Group> {
    const trimmed = name.trim();
    if (!trimmed) throw new DataError('invalid', '组名不能为空');
    return groupFromRow(
      check(
        await this.client.rpc('create_group', { p_name: trimmed }),
        '建组',
      ) as TableRow<'groups'>,
    );
  }

  async roster(groupId: string): Promise<GroupMember[]> {
    const rows = check(await this.client.rpc('group_roster', { p_group_id: groupId }), '查询名单');
    return rows.map((row) => ({
      userId: row.user_id,
      nickname: row.nickname,
      hasCustomNickname: row.has_custom_nickname,
      isMe: row.is_me,
      joinedAt: new Date(row.joined_at),
    }));
  }

  async setNickname(groupId: string, nickname: string | null): Promise<void> {
    const value = nickname?.trim() || null;
    check(
      await this.client
        .from('group_members')
        .update({ nickname: value })
        .eq('group_id', groupId)
        .eq('user_id', this.userId),
      '修改昵称',
    );
  }

  async invite(groupId: string, email: string): Promise<InviteResult> {
    return check(
      await this.client.rpc('invite_to_group', { p_group_id: groupId, p_email: email }),
      '邀请',
    );
  }

  async notifications(): Promise<{ items: GroupNotification[]; seenAt: Date | null }> {
    const [rows, me] = await Promise.all([
      this.client.rpc('my_notifications'),
      this.client.from('users').select('notifications_seen_at').eq('id', this.userId).maybeSingle(),
    ]);
    const items = check(rows, '查询通知').map((row) => ({
      kind: row.kind,
      id: row.id,
      groupId: row.group_id,
      groupName: row.group_name,
      actorName: row.actor_name,
      createdAt: new Date(row.created_at),
    }));
    const seen = check(me, '查询通知')?.notifications_seen_at ?? null;
    return { items, seenAt: seen ? new Date(seen) : null };
  }

  async markNotificationsSeen(): Promise<Date> {
    return new Date(check(await this.client.rpc('mark_notifications_seen'), '标记通知已读'));
  }

  async acceptInvitation(invitationId: string): Promise<string> {
    return check(
      await this.client.rpc('accept_group_invitation', { p_invitation_id: invitationId }),
      '接受邀请',
    );
  }

  async declineInvitation(invitationId: string): Promise<void> {
    check(
      await this.client.rpc('decline_group_invitation', { p_invitation_id: invitationId }),
      '拒绝邀请',
    );
  }

  async deletionRequest(groupId: string): Promise<GroupDeletionRequest | null> {
    const { data: request, error } = await this.client
      .from('group_deletion_requests')
      .select('group_id, initiated_by, started_at')
      .eq('group_id', groupId)
      .maybeSingle();
    if (error) check({ data: null, error }, '查询删除投票');
    if (!request) return null;
    const votes = check(
      await this.client.from('group_deletion_votes').select('user_id').eq('group_id', groupId),
      '查询删除投票',
    );
    return {
      groupId,
      initiatedBy: request.initiated_by,
      startedAt: new Date(request.started_at),
      agreedUserIds: votes.map((v) => v.user_id),
    };
  }

  async requestDeletion(groupId: string): Promise<DeletionRequestResult> {
    return check(
      await this.client.rpc('request_group_deletion', { p_group_id: groupId }),
      '发起删除组',
    );
  }

  async voteDeletion(groupId: string, agree: boolean): Promise<DeletionVoteResult> {
    return check(
      await this.client.rpc('vote_group_deletion', { p_group_id: groupId, p_agree: agree }),
      '删除组投票',
    );
  }

  async processExpiredDeletions(): Promise<number> {
    return check(await this.client.rpc('process_expired_group_deletions'), '检查删除组投票');
  }
}
