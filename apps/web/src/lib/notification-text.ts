import type { GroupNotification } from '@alethego/data';

import type { Messages } from '@/i18n';

/**
 * 把结构化的通知（操作者、动作、对象、任务、改动的字段）拼成一句话。文案都来自 Messages。
 * - 对象是收到通知的人自己时显示"你"，否则显示他在本组的名字
 * - "修改"里有删除 / 恢复时，整句说成"删除了 / 恢复了某任务"
 */
export function notificationText(item: GroupNotification, m: Messages): string {
  const actor = item.actorName;
  const group = item.groupName;
  const task = item.taskTitle ?? '';
  const subject = item.subjectIsMe ? m.you : (item.subjectName ?? '');
  switch (item.kind) {
    case 'group_invitation':
      return m.notification.groupInvitation({ actor, group });
    case 'group_deletion_vote':
      return m.notification.groupDeletionVote({ actor, group });
    case 'group_leader_vote':
      return m.notification.groupLeaderVote({ actor, subject, group });
    case 'task':
      break;
  }
  switch (item.action) {
    case 'assigned':
      return m.notification.assigned({ actor, subject, task, role: m.raciRoles.R });
    case 'completed':
      return m.notification.completed({ actor, task });
    case 'confirmed':
      return m.notification.confirmed({ actor, task });
    case 'rejected':
      return m.notification.rejected({ actor, task });
    case 'modified':
    case null:
      if (item.fields.includes('deleted')) return m.notification.deleted({ actor, task });
      if (item.fields.includes('restored')) return m.notification.restored({ actor, task });
      return m.notification.modified({
        actor,
        task,
        fields: m.joinList(item.fields.map((field) => m.fields[field])),
      });
  }
}
