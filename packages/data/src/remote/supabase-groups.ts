import type {
  Group,
  GroupContact,
  GroupKind,
  GroupMember,
  GroupRole,
  TaskAssignment,
} from '@alethego/core';
import type { PostgrestError } from '@supabase/supabase-js';

import { DataError } from '../errors';
import type {
  AssignmentDraft,
  DeletionRequestResult,
  DeletionVoteResult,
  GroupDeletionRequest,
  GroupNotification,
  IAssignmentRepository,
  IGroupRepository,
  InviteResult,
  LeaderRequest,
  LeaderRequestResult,
  LeaderVoteResult,
  LeaveResult,
  MemberTaskRole,
  RemoveMemberResult,
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

export function groupFromRow(row: TableRow<'groups'>, myRole: GroupRole): Group {
  return {
    id: row.id,
    kind: row.kind as GroupKind,
    name: row.name,
    color: row.color ?? null,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    myRole,
  };
}

function contactFromRow(row: TableRow<'group_contacts'>): GroupContact {
  return { id: row.id, groupId: row.group_id, name: row.name };
}

/** 组的存取：写操作都调用数据库函数，函数内按组的类型检查身份 */
export class SupabaseGroupRepository implements IGroupRepository {
  constructor(
    private readonly client: TaskAppSupabaseClient,
    private readonly userId: string,
  ) {}

  async list(): Promise<Group[]> {
    const [groups, memberships] = await Promise.all([
      this.client.from('groups').select('*').order('created_at', { ascending: true }),
      this.client.from('group_members').select('group_id, role').eq('user_id', this.userId),
    ]);
    const roles = new Map(check(memberships, '查询组').map((m) => [m.group_id, m.role]));
    return check(groups, '查询组').flatMap((row) => {
      const role = roles.get(row.id);
      return role ? [groupFromRow(row, role)] : [];
    });
  }

  async create(input: { name: string; kind: GroupKind; color: string | null }): Promise<Group> {
    const trimmed = input.name.trim();
    if (!trimmed) throw new DataError('invalid', '组名不能为空');
    const row = check(
      await this.client.rpc('create_group_v2', {
        p_name: trimmed,
        p_kind: input.kind,
        p_color: input.color,
      }),
      '建组',
    ) as TableRow<'groups'>;
    return groupFromRow(row, 'leader');
  }

  async update(groupId: string, input: { name: string; color: string | null }): Promise<Group> {
    const trimmed = input.name.trim();
    if (!trimmed) throw new DataError('invalid', '组名不能为空');
    const row = check(
      await this.client.rpc('update_group', {
        p_group_id: groupId,
        p_name: trimmed,
        p_color: input.color,
      }),
      '修改组',
    ) as TableRow<'groups'>;
    return groupFromRow(row, 'leader');
  }

  async roster(groupId: string): Promise<GroupMember[]> {
    const rows = check(await this.client.rpc('group_roster', { p_group_id: groupId }), '查询名单');
    return rows.map((row) => ({
      userId: row.user_id,
      nickname: row.nickname,
      hasCustomNickname: row.has_custom_nickname,
      isMe: row.is_me,
      joinedAt: new Date(row.joined_at),
      role: row.role,
      email: row.email,
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
      actorName: row.actor_name ?? '',
      createdAt: new Date(row.created_at),
      taskId: row.task_id,
      taskTitle: row.task_title,
      subjectName: row.subject_name,
      subjectIsMe: row.subject_is_me ?? false,
      action: row.action,
      fields: (row.fields ?? []) as GroupNotification['fields'],
      canConfirm: row.can_confirm,
      taskDeleted: row.task_deleted,
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

  async processTimeouts(): Promise<number> {
    return check(await this.client.rpc('process_group_timeouts'), '检查投票');
  }

  async contacts(groupId: string): Promise<GroupContact[]> {
    const rows = check(
      await this.client
        .from('group_contacts')
        .select('*')
        .eq('group_id', groupId)
        .order('created_at', { ascending: true }),
      '查询名单',
    );
    return rows.map(contactFromRow);
  }

  async addContact(groupId: string, name: string): Promise<GroupContact> {
    const trimmed = name.trim();
    if (!trimmed) throw new DataError('invalid', '名字不能为空');
    return contactFromRow(
      check(
        await this.client.rpc('add_group_contact', { p_group_id: groupId, p_name: trimmed }),
        '添加',
      ) as TableRow<'group_contacts'>,
    );
  }

  async removeContact(contactId: string): Promise<void> {
    check(await this.client.rpc('remove_group_contact', { p_contact_id: contactId }), '删除');
  }

  async setRole(groupId: string, userId: string, role: 'admin' | 'member'): Promise<void> {
    check(
      await this.client.rpc('set_group_member_role', {
        p_group_id: groupId,
        p_user_id: userId,
        p_role: role,
      }),
      role === 'admin' ? '任命管理员' : '撤销管理员',
    );
  }

  async leaderRequests(groupId: string): Promise<LeaderRequest[]> {
    const rows = check(
      await this.client.from('group_leader_requests').select('*').eq('group_id', groupId),
      '查询任命',
    );
    return rows.map((row) => ({
      id: row.id,
      groupId: row.group_id,
      candidateId: row.candidate_id,
      initiatedBy: row.initiated_by,
      startedAt: new Date(row.started_at),
    }));
  }

  async requestLeader(groupId: string, userId: string): Promise<LeaderRequestResult> {
    return check(
      await this.client.rpc('request_leader_appointment', {
        p_group_id: groupId,
        p_user_id: userId,
      }),
      '任命组长',
    );
  }

  async voteLeader(requestId: string, agree: boolean): Promise<LeaderVoteResult> {
    return check(
      await this.client.rpc('vote_leader_appointment', {
        p_request_id: requestId,
        p_agree: agree,
      }),
      '任命组长投票',
    );
  }

  async memberTaskRoles(groupId: string, userId: string): Promise<MemberTaskRole[]> {
    const rows = check(
      await this.client.rpc('member_task_roles', { p_group_id: groupId, p_user_id: userId }),
      '查询 RACI',
    );
    return rows.map((row) => ({ taskId: row.task_id, taskTitle: row.task_title, role: row.role }));
  }

  async removeMember(groupId: string, userId: string): Promise<RemoveMemberResult> {
    return check(
      await this.client.rpc('remove_group_member', { p_group_id: groupId, p_user_id: userId }),
      '踢出',
    );
  }

  async leave(groupId: string): Promise<LeaveResult> {
    return check(await this.client.rpc('leave_group', { p_group_id: groupId }), '退出');
  }

  async dismissNotification(id: string): Promise<void> {
    check(await this.client.rpc('dismiss_notification', { p_id: id }), '处理通知');
  }
}

/** 任务上的 RACI：读表，写入走数据库函数（检查身份、发"分配给你"的通知） */
export class SupabaseAssignmentRepository implements IAssignmentRepository {
  constructor(private readonly client: TaskAppSupabaseClient) {}

  async listForTasks(taskIds: readonly string[]): Promise<TaskAssignment[]> {
    if (taskIds.length === 0) return [];
    const rows: TableRow<'task_assignments'>[] = [];
    // 分批查询，避免地址过长
    for (let i = 0; i < taskIds.length; i += 100) {
      rows.push(
        ...check(
          await this.client
            .from('task_assignments')
            .select('*')
            .in('task_id', taskIds.slice(i, i + 100))
            .order('created_at', { ascending: true }),
          '查询 RACI',
        ),
      );
    }
    return rows.map((row) => ({
      taskId: row.task_id,
      role: row.role,
      userId: row.user_id,
      contactId: row.contact_id,
    }));
  }

  async set(taskId: string, assignments: readonly AssignmentDraft[]): Promise<void> {
    check(
      await this.client.rpc('set_task_raci', {
        p_task_id: taskId,
        p_assignments: assignments.map((a) =>
          a.userId
            ? { role: a.role, user_id: a.userId }
            : { role: a.role, contact_id: a.contactId },
        ),
      }),
      '设定 RACI',
    );
  }
}
