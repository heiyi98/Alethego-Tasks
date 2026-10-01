'use client';

import type { GroupNotification } from '@alethego/data';
import { useState } from 'react';

import { BellIcon, IconButton } from './icons';
import { useRepositories } from './repositories-provider';
import { useTaskData } from './task-data-provider';
import { errorMessage } from '@/lib/format';

/**
 * 通知（只在应用内）：侧边栏底部账号旁边的铃铛，有未读时带一个小圆点。
 * 点开列出通知并全部记为已读；这一批有两种：入组邀请（同意 / 拒绝）、删除组的投票（同意 / 不同意）。
 */
export function NotificationBell() {
  const repositories = useRepositories();
  const { data, reload } = useTaskData();
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
      } else {
        await repositories.groups.voteDeletion(item.groupId, agree);
      }
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
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
                const invitation = item.kind === 'group_invitation';
                return (
                  <li key={key} className="notification-item">
                    <p className="notification-text">
                      {invitation
                        ? `${item.actorName} 邀请你加入「${item.groupName}」`
                        : `${item.actorName} 发起删除「${item.groupName}」`}
                    </p>
                    <div className="notification-actions">
                      <button
                        type="button"
                        className="button-link"
                        disabled={busy === key}
                        onClick={() => void act(item, false)}
                      >
                        {invitation ? '拒绝' : '不同意'}
                      </button>
                      <button
                        type="button"
                        className="button-primary button-small"
                        disabled={busy === key}
                        onClick={() => void act(item, true)}
                      >
                        同意
                      </button>
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
