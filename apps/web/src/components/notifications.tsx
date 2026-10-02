'use client';

import { deriveListStatus } from '@alethego/core';
import type { GroupNotification } from '@alethego/data';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { BellIcon, IconButton, XIcon } from './icons';
import { useRepositories } from './repositories-provider';
import { useSelection } from './selection';
import { useTaskData } from './task-data-provider';
import { messages } from '@/i18n';
import { errorMessage } from '@/lib/format';
import { notificationText } from '@/lib/notification-text';
import { groupHref } from '@/lib/selection';

/**
 * 通知（只在应用内）：侧边栏左下角账号旁边的铃铛，有未读时带一个小圆点。
 * 点铃铛，通知以窗口的形式出现在铃铛上方（铃铛和账号的位置不动），打开时全部记为已读。
 * - 入组邀请、项目邀请：同意 / 拒绝；删除组、删除项目、任命组长的投票：同意 / 不同意
 * - 负责人收到的"完成"（任务还待确认）：确认 / 查看
 * - 其他任务通知：✕ / 查看（查看或关掉后不再显示）；任务已删除时只有 ✕
 */
export function NotificationBell() {
  const repositories = useRepositories();
  const { data, reload, now, timeZone } = useTaskData();
  const selection = useSelection();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const items = data?.notifications ?? [];
  const seenAt = data?.notificationsSeenAt ?? null;
  const unread = items.some((item) => !seenAt || item.createdAt > seenAt);

  // 点窗口外面或按 Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (document.querySelector('[data-dialog-open]')) return;
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

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
      } else if (item.kind === 'project_invitation') {
        if (agree) await repositories.projects.acceptInvitation(item.id);
        else await repositories.projects.declineInvitation(item.id);
      } else if (item.kind === 'group_deletion_vote') {
        await repositories.groups.voteDeletion(item.groupId, agree);
      } else if (item.kind === 'project_deletion_vote') {
        await repositories.projects.voteDeletion(item.projectId!, agree);
      } else if (item.kind === 'group_leader_vote') {
        await repositories.groups.voteLeader(item.id, agree);
      } else if (agree && item.canConfirm) {
        // 负责人直接确认完成（退回要在任务详情里点）
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

  /**
   * 查看：进入这条任务所在的项目，在清单里原地展开它的详情并滚动到屏幕中间。
   * 当前的状态行看不到这条任务时，切到它所在的状态。
   */
  function viewTask(item: GroupNotification) {
    if (!item.taskId) return;
    setOpen(false);
    if (!item.canConfirm) {
      void repositories.groups.dismissNotification(item.id).then(reload);
    }
    const task = data?.tasks.find((t) => t.id === item.taskId);
    let status = selection.status;
    if (task) {
      const own = deriveListStatus(task, data?.occurrencesByTask.get(task.id) ?? [], {
        now,
        timeZone,
      });
      if (status !== 'all' && status !== own) status = own;
    }
    const href = groupHref({ ...selection, status }, item.groupId, item.projectId);
    router.push(`${href}&task=${item.taskId}`);
  }

  return (
    <div className="notification-root" ref={rootRef}>
      <IconButton
        label="通知"
        className={`notification-bell${unread ? ' notification-bell-unread' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-unread={unread || undefined}
        onClick={() => void toggle()}
      >
        <BellIcon />
        {unread && <span className="notification-dot" aria-hidden />}
      </IconButton>

      {open && (
        <section className="notification-panel" role="dialog" aria-label="通知列表">
          {items.length === 0 ? (
            <p className="muted notification-empty">没有通知</p>
          ) : (
            <ul>
              {items.map((item) => {
                const key = `${item.kind}:${item.id}`;
                const vote = item.kind !== 'task';
                const view = () => viewTask(item);
                return (
                  <li key={key} className="notification-item">
                    <p className="notification-text">{notificationText(item, messages)}</p>
                    <div className="notification-actions">
                      {vote ? (
                        <>
                          <button
                            type="button"
                            className="button-link"
                            disabled={busy === key}
                            onClick={() => void act(item, false)}
                          >
                            {item.kind === 'group_invitation' || item.kind === 'project_invitation'
                              ? '拒绝'
                              : '不同意'}
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
                      ) : item.canConfirm ? (
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
                          {!item.taskDeleted && (
                            <button
                              type="button"
                              className="button-primary button-small"
                              disabled={busy === key}
                              onClick={view}
                            >
                              查看
                            </button>
                          )}
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
    </div>
  );
}
