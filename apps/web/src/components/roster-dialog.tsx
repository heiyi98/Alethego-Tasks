'use client';

import {
  CONTAINER_FEATURES,
  GROUP_ROLE_LABELS,
  memberActions,
  type Group,
  type GroupContact,
  type GroupMember,
} from '@alethego/core';
import type { InviteResult } from '@alethego/data';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { useCurrentGroup } from './current-group';
import { useFeedback } from './feedback-provider';
import { IconButton, MoreIcon, TrashIcon, XIcon } from './icons';
import { RaciRolesList } from './raci-roles-list';
import { useRepositories } from './repositories-provider';
import { useTaskData } from './task-data-provider';
import { errorMessage } from '@/lib/format';

const INVITE_MESSAGES: Record<InviteResult, string> = {
  invited: '已邀请',
  already_invited: '已经邀请过',
  already_member: '已经在组里',
  self: '不能邀请自己',
};

/**
 * 名单窗口（参照 Google 的共享窗口）：上面输入邮箱邀请，下面列出组里所有人（包括只有名字的人）。
 * 按我的身份显示可用的操作：任命 / 撤销管理员、任命组长、踢出、删除只有名字的人、退出组。
 * 任命、撤销、踢出都先弹确认窗口；踢出 / 退出时列出这个人身上的 RACI。
 */
export function RosterDialog({ group, onClose }: { group: Group; onClose: () => void }) {
  const repositories = useRepositories();
  const { reload } = useTaskData();
  const { members, contacts, permissions, features, reloadRoster } = useCurrentGroup();
  const { confirm, notify } = useFeedback();
  const router = useRouter();
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 打开时刷新名单（别人可能刚刚入组、退出或改了昵称）
  useEffect(() => {
    void reloadRoster();
  }, [reloadRoster]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[data-dialog-open]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setMenuFor(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    }
    await Promise.all([reloadRoster(), reload()]);
  }

  const alert = (message: string, detail?: ReactNode) =>
    confirm({ message, detail, confirmLabel: '', cancelLabel: '关闭', alertOnly: true });

  async function appointAdmin(member: GroupMember) {
    setMenuFor(null);
    const ok = await confirm({
      message: `任命「${member.nickname}」为管理员？`,
      confirmLabel: '任命',
      cancelLabel: '取消',
    });
    if (ok) await run(() => repositories.groups.setRole(group.id, member.userId, 'admin'));
  }

  async function revokeAdmin(member: GroupMember) {
    setMenuFor(null);
    const ok = await confirm({
      message: `撤销「${member.nickname}」的管理员？`,
      confirmLabel: '撤销',
      cancelLabel: '取消',
      destructive: true,
    });
    if (ok) await run(() => repositories.groups.setRole(group.id, member.userId, 'member'));
  }

  async function appointLeader(member: GroupMember) {
    setMenuFor(null);
    const ok = await confirm({
      message: `任命「${member.nickname}」为组长？`,
      confirmLabel: '任命',
      cancelLabel: '取消',
    });
    if (!ok) return;
    await run(async () => {
      const result = await repositories.groups.requestLeader(group.id, member.userId);
      notify(result === 'appointed' ? '已任命' : '已发起投票');
    });
  }

  /** 踢出：身上有 R 或 A 时不能踢，列出他的 R、A、C、I；否则确认窗口里列出他的 C、I */
  async function remove(member: GroupMember) {
    setMenuFor(null);
    const roles = await repositories.groups.memberTaskRoles(group.id, member.userId);
    if (roles.some((r) => r.role === 'R' || r.role === 'A')) {
      await alert(`不能踢出「${member.nickname}」`, <RaciRolesList roles={roles} />);
      return;
    }
    const ci = roles.filter((r) => r.role === 'C' || r.role === 'I');
    const ok = await confirm({
      message: `踢出「${member.nickname}」？`,
      detail: ci.length > 0 ? <RaciRolesList roles={ci} /> : undefined,
      confirmLabel: '踢出',
      cancelLabel: '取消',
      destructive: true,
    });
    if (!ok) return;
    await run(async () => {
      if ((await repositories.groups.removeMember(group.id, member.userId)) === 'blocked') {
        const latest = await repositories.groups.memberTaskRoles(group.id, member.userId);
        await alert(`不能踢出「${member.nickname}」`, <RaciRolesList roles={latest} />);
      }
    });
  }

  /** 退出：管理组里身上有 R 或 A 时不能退出；最后一位组长不能退出；合作组直接确认 */
  async function leave(me: GroupMember) {
    setMenuFor(null);
    const management = features.raci;
    let detail: ReactNode;
    if (management) {
      const roles = await repositories.groups.memberTaskRoles(group.id, me.userId);
      if (roles.some((r) => r.role === 'R' || r.role === 'A')) {
        await alert('不能退出', <RaciRolesList roles={roles} />);
        return;
      }
      if (me.role === 'leader' && !members.some((m) => !m.isMe && m.role === 'leader')) {
        await alert('最后一位组长不能退出');
        return;
      }
      const ci = roles.filter((r) => r.role === 'C' || r.role === 'I');
      if (ci.length > 0) detail = <RaciRolesList roles={ci} />;
    }
    const ok = await confirm({
      message: `退出「${group.name}」？`,
      detail,
      confirmLabel: '退出',
      cancelLabel: '取消',
      destructive: true,
    });
    if (!ok) return;
    try {
      const result = await repositories.groups.leave(group.id);
      if (result === 'blocked') {
        const roles = await repositories.groups.memberTaskRoles(group.id, me.userId);
        await alert('不能退出', <RaciRolesList roles={roles} />);
        return;
      }
      if (result === 'last_leader') {
        await alert('最后一位组长不能退出');
        return;
      }
      onClose();
      router.replace('/', { scroll: false });
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function removeContact(contact: GroupContact) {
    const ok = await confirm({
      message: `删除「${contact.name}」？`,
      confirmLabel: '删除',
      cancelLabel: '取消',
      destructive: true,
    });
    if (ok) await run(() => repositories.groups.removeContact(contact.id));
  }

  const myRole = group.myRole;
  const showRoles = CONTAINER_FEATURES[group.kind].roles;

  return (
    <div className="modal-backdrop" data-keep-panel onClick={onClose}>
      <div
        className="roster-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="名单"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="roster-header">
          <h2>{group.name}</h2>
          <IconButton label="关闭" onClick={onClose}>
            <XIcon />
          </IconButton>
        </div>

        {permissions?.invite && <InviteForm groupId={group.id} />}
        {permissions?.manageContacts && (
          <AddContactForm groupId={group.id} onAdded={() => run(async () => {})} />
        )}

        <ul className="roster-list" aria-label="成员">
          {members.map((member) => {
            const actions = memberActions(group.kind, myRole, member);
            const canLeave = member.isMe && features.leavable;
            const hasActions = Object.values(actions).some(Boolean) || canLeave;
            const open = menuFor === member.userId;
            return (
              <li key={member.userId} className="roster-row" data-user-id={member.userId}>
                <div className="roster-person">
                  <span className="roster-avatar" aria-hidden>
                    {member.nickname.slice(0, 1)}
                  </span>
                  <span className="roster-names">
                    <span className="roster-name">{member.nickname}</span>
                    <span className="roster-email">{member.email}</span>
                  </span>
                  {showRoles && (
                    <span className="roster-role">{GROUP_ROLE_LABELS[member.role]}</span>
                  )}
                  {hasActions && (
                    <IconButton
                      label={`「${member.nickname}」的操作`}
                      aria-expanded={open}
                      onClick={() => setMenuFor(open ? null : member.userId)}
                    >
                      <MoreIcon />
                    </IconButton>
                  )}
                </div>
                {open && (
                  <div className="roster-actions">
                    {actions.appointAdmin && (
                      <button type="button" onClick={() => void appointAdmin(member)}>
                        任命为管理员
                      </button>
                    )}
                    {actions.revokeAdmin && (
                      <button type="button" onClick={() => void revokeAdmin(member)}>
                        撤销管理员
                      </button>
                    )}
                    {actions.appointLeader && (
                      <button type="button" onClick={() => void appointLeader(member)}>
                        任命为组长
                      </button>
                    )}
                    {actions.remove && (
                      <button
                        type="button"
                        className="roster-danger"
                        onClick={() => void remove(member)}
                      >
                        踢出
                      </button>
                    )}
                    {canLeave && (
                      <button
                        type="button"
                        className="roster-danger"
                        onClick={() => void leave(member)}
                      >
                        退出组
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
          {contacts.map((contact) => (
            <li key={contact.id} className="roster-row roster-contact">
              <div className="roster-person">
                <span className="roster-avatar" aria-hidden>
                  {contact.name.slice(0, 1)}
                </span>
                <span className="roster-names">
                  <span className="roster-name">{contact.name}</span>
                </span>
                {permissions?.manageContacts && (
                  <IconButton
                    label={`删除「${contact.name}」`}
                    onClick={() => void removeContact(contact)}
                  >
                    <TrashIcon size={16} />
                  </IconButton>
                )}
              </div>
            </li>
          ))}
        </ul>
        {error && <p className="field-error">{error}</p>}
      </div>
    </div>
  );
}

function InviteForm({ groupId }: { groupId: string }) {
  const repositories = useRepositories();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function invite(event: FormEvent) {
    event.preventDefault();
    const value = email.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      const result = await repositories.groups.invite(groupId, value);
      setMessage(`${INVITE_MESSAGES[result]}：${value.toLowerCase()}`);
      if (result === 'invited') setEmail('');
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="roster-form" aria-label="邀请" onSubmit={invite}>
      <div className="roster-form-row">
        <input
          type="email"
          aria-label="邀请的邮箱"
          placeholder="邮箱"
          value={email}
          autoFocus
          onChange={(event) => {
            setEmail(event.target.value);
            setMessage(null);
          }}
        />
        <button type="submit" className="button-primary" disabled={busy || !email.trim()}>
          邀请
        </button>
      </div>
      {message && (
        <p className="muted roster-message" role="status">
          {message}
        </p>
      )}
    </form>
  );
}

function AddContactForm({ groupId, onAdded }: { groupId: string; onAdded: () => Promise<void> }) {
  const repositories = useRepositories();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function add(event: FormEvent) {
    event.preventDefault();
    const value = name.trim();
    if (!value) return;
    try {
      await repositories.groups.addContact(groupId, value);
      setName('');
      setError(null);
      await onAdded();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <form className="roster-form" aria-label="添加只有名字的人" onSubmit={add}>
      <div className="roster-form-row">
        <input
          aria-label="名字"
          placeholder="名字"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" className="button-primary" disabled={!name.trim()}>
          添加
        </button>
      </div>
      {error && <p className="field-error">{error}</p>}
    </form>
  );
}
