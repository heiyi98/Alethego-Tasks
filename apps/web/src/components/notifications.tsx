'use client';

import type { GroupNotification } from '@alethego/data';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { BellIcon, IconButton, XIcon } from './icons';
import { useRepositories } from './repositories-provider';
import { useSelection } from './selection';
import { useTaskData } from './task-data-provider';
import { errorMessage } from '@/lib/format';
import { groupHref } from '@/lib/selection';

/** 通知的文字 */
function notificationText(item: GroupNotification): string {
  const task = `「${item.taskTitle ?? ''}」`;
  switch (item.kind) {
    case 'group_invitation':
      return `${item.actorName} 邀请你加入「${item.groupName}」`;
    case 'group_deletion_vote':
      return `${item.actorName} 发起删除「${item.groupName}」`;
    case 'group_leader_vote':
      return `${item.actorName} 提议任命 ${item.subjectName ?? ''} 为「${item.groupName}」的组长`;
    case 'task_assigned':
      return `${item.actorName} 把${task}分配给你`;
    case 'task_completed':
      return `${item.actorName} 完成了${task}`;
    case 'task_rejected':
      return `${item.actorName} 没有通过${task}`;
    case 'task_changed':
      return `${item.actorName} 更新了${task}`;
  }
}

/**
 * 通知（只在应用内）：侧边栏底部账号旁边的铃铛，有未读时带一个小圆点。点开列出通知并全部记为已读。
 * - 入组邀请：同意 / 拒绝；删除组、任命组长的投票：同意 / 不同意
 * - R 标记完成（发给 A）：确认（直接确认完成）/ 查看（进入组并打开这条任务）
 * - 分配给你、没有通过、任务有变化：查看 / ✕（看过或关掉后不再显示）
 */
export function NotificationBell() {
  const repositories = useRepositories();
  const { data, reload } = useTaskData();
  const selection = useSelection();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items = data?.notifications ?? [];
  const seenAt = data?.notificationsSeenAt ?? null;
  const unread = items.some((item) => !seenAt || item.createdAt > seenAt);

  async function toggle() {
    const next = !open;
    setOpen(next);
    setError(null);
    if (next && unread) {
      try {
        await repositories.groups.markNotificationsSeen();
        await reload();
      } catch (e) {
        setError(errorMessage(e));
      }
    }
  }

  async function act(item: GroupNotification, agree: boolean) {
    const key = `${item.kind}:${item.id}`;
    setBusy(key);
    setError(null);
    try {
      if (item.kind === 'group_invitation') {
        if (agree) await repositories.groups.acceptInvitation(item.id);
        else await repositories.groups.declineInvitation(item.id);
      } else if (item.kind === 'group_deletion_vote') {
        await repositories.groups.voteDeletion(item.groupId, agree);
      } else if (item.kind === 'group_leader_vote') {
        await repositories.groups.voteLeader(item.id, agree);
      } else if (item.kind === 'task_completed') {
        // 确认完成（不通过要在任务详情里点）
        await repositories.tasks.update(item.taskId!, { confirmedAt: new Date() });
      } else {
        await repositories.groups.dismissNotification(item.id);
      }
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  /** 查看：进入这个组并打开这条任务的详情（状态行切到"全部"，保证任务在清单里） */
  async function viewTask(item: GroupNotification) {
    if (!item.taskId) return;
    setOpen(false);
    if (item.kind !== 'task_completed') {
      void repositories.groups.dismissNotification(item.id).then(reload);
    }
    const href = groupHref({ ...selection, status: 'all' }, item.groupId);
    router.push(`${href}&task=${item.taskId}`);
  }

  return (
    <>
      <IconButton
        label="通知"
        className={`notification-bell${unread ? ' notification-bell-unread' : ''}`}
        aria-expanded={open}
        data-unread={unread || undefined}
        onClick={() => void toggle()}
      >
        <BellIcon />
        {unread && <span className="notification-dot" aria-hidden />}
      </IconButton>

      {open && (
        <section className="notification-panel" aria-label="通知列表">
          {items.length === 0 ? (
            <p className="muted notification-empty">没有通知</p>
          ) : (
            <ul>
              {items.map((item) => {
                const key = `${item.kind}:${item.id}`;
                const vote =
                  item.kind === 'group_invitation' ||
                  item.kind === 'group_deletion_vote' ||
                  item.kind === 'group_leader_vote';
                const view = () => void viewTask(item);
                return (
                  <li key={key} className="notification-item">
                    <p className="notification-text">{notificationText(item)}</p>
                    <div className="notification-actions">
                      {vote ? (
                        <>
                          <button
                            type="button"
                            className="button-link"
                            disabled={busy === key}
                            onClick={() => void act(item, false)}
                          >
                            {item.kind === 'group_invitation' ? '拒绝' : '不同意'}
                          </button>
                          <button
                            type="button"
                            className="button-primary button-small"
                            disabled={busy === key}
                            onClick={() => void act(item, true)}
                          >
                            同意
                          </button>
                        </>
                      ) : item.kind === 'task_completed' ? (
                        <>
                          <button
                            type="button"
                            className="button-link"
                            disabled={busy === key}
                            onClick={view}
                          >
                            查看
                          </button>
                          <button
                            type="button"
                            className="button-primary button-small"
                            disabled={busy === key}
                            onClick={() => void act(item, true)}
                          >
                            确认
                          </button>
                        </>
                      ) : (
                        <>
                          <IconButton
                            label="关闭这条通知"
                            className="icon-button-small"
                            disabled={busy === key}
                            onClick={() => void act(item, false)}
                          >
                            <XIcon size={14} />
                          </IconButton>
                          <button
                            type="button"
                            className="button-primary button-small"
                            disabled={busy === key}
                            onClick={view}
                          >
                            查看
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {error && <p className="field-error">{error}</p>}
        </section>
      )}
    </>
  );
}
