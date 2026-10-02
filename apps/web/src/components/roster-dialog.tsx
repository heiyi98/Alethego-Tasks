'use client';

import {
  GROUP_KIND_CONFIG,
  ROLE_LABELS,
  groupMemberActions,
  projectMemberActions,
  type Group,
  type GroupMember,
  type Project,
  type ProjectContact,
  type ProjectMember,
} from '@alethego/core';
import type { InviteResult, ProjectInviteResult } from '@alethego/data';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { useCurrentGroup } from './current-group';
import { useFeedback } from './feedback-provider';
import { IconButton, MoreIcon, TrashIcon, XIcon } from './icons';
import { RaciRolesList } from './raci-roles-list';
import { useRepositories } from './repositories-provider';
import { useSelection } from './selection';
import { useTaskData } from './task-data-provider';
import { errorMessage } from '@/lib/format';
import { groupHref } from '@/lib/selection';

const INVITE_MESSAGES: Record<ProjectInviteResult, string> = {
  invited: '已邀请',
  added: '已加入',
  already_invited: '已经邀请过',
  already_member: '已经在名单里',
  self: '不能邀请自己',
};

/** 名单窗口的外框（参照 Google 的共享窗口）：标题、关闭，下面是表单和名单 */
function RosterFrame({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[data-dialog-open]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
          <h2>{title}</h2>
          <IconButton label="关闭" onClick={onClose}>
            <XIcon />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

/** 名单里的一行：头像、名字、邮箱、身份，以及"…"展开的操作 */
function RosterRow({
  person,
  roleLabel,
  open,
  onToggle,
  actions,
}: {
  person: { userId: string; nickname: string; email: string };
  roleLabel: string | null;
  open: boolean;
  onToggle: () => void;
  actions: ReactNode[];
}) {
  const shown = actions.filter(Boolean);
  return (
    <li className="roster-row" data-user-id={person.userId}>
      <div className="roster-person">
        <span className="roster-avatar" aria-hidden>
          {person.nickname.slice(0, 1)}
        </span>
        <span className="roster-names">
          <span className="roster-name">{person.nickname}</span>
          <span className="roster-email">{person.email}</span>
        </span>
        {roleLabel && <span className="roster-role">{roleLabel}</span>}
        {shown.length > 0 && (
          <IconButton
            label={`「${person.nickname}」的操作`}
            aria-expanded={open}
            onClick={onToggle}
          >
            <MoreIcon />
          </IconButton>
        )}
      </div>
      {open && shown.length > 0 && <div className="roster-actions">{shown}</div>}
    </li>
  );
}

function useRosterActions(onDone: () => Promise<void>) {
  const { confirm } = useFeedback();
  const [error, setError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setMenuFor(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    }
    await onDone();
  }

  const alert = (message: string, detail?: ReactNode) =>
    confirm({ message, detail, confirmLabel: '', cancelLabel: '关闭', alertOnly: true });

  return { error, setError, menuFor, setMenuFor, run, alert, confirm };
}

/* ------------------------------------------------------------------ */
/* 组名单                                                               */
/* ------------------------------------------------------------------ */

/**
 * 组名单（组页面标题右边的按钮；只在项目里的人看不到）：组长邀请人进组、任命组长、踢出组；
 * 每个人都能退出组。踢出 / 退出时检查他在组里所有项目上的 RACI。
 */
export function GroupRosterDialog({ group, onClose }: { group: Group; onClose: () => void }) {
  const repositories = useRepositories();
  const { reload } = useTaskData();
  const { members, permissions, reloadRoster } = useCurrentGroup();
  const { notify } = useFeedback();
  const router = useRouter();
  const { error, setError, menuFor, setMenuFor, run, alert, confirm } = useRosterActions(
    async () => {
      await Promise.all([reloadRoster(), reload()]);
    },
  );

  // 打开时刷新名单（别人可能刚刚入组、退出或改了昵称）
  useEffect(() => {
    void reloadRoster();
  }, [reloadRoster]);

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

  /** 踢出组：他在任何项目上有 R 或 A 时不能踢，列出他的 RACI；否则确认窗口里列出他的 C、I */
  async function remove(member: GroupMember) {
    setMenuFor(null);
    const roles = await repositories.groups.memberTaskRoles(group.id, member.userId);
    if (roles.some((r) => r.role === 'R' || r.role === 'A')) {
      await alert(`不能踢出「${member.nickname}」`, <RaciRolesList roles={roles} showProject />);
      return;
    }
    const ci = roles.filter((r) => r.role === 'C' || r.role === 'I');
    const ok = await confirm({
      message: `踢出「${member.nickname}」？`,
      detail: ci.length > 0 ? <RaciRolesList roles={ci} showProject /> : undefined,
      confirmLabel: '踢出',
      cancelLabel: '取消',
      destructive: true,
    });
    if (!ok) return;
    await run(async () => {
      if ((await repositories.groups.removeMember(group.id, member.userId)) === 'blocked') {
        const latest = await repositories.groups.memberTaskRoles(group.id, member.userId);
        await alert(`不能踢出「${member.nickname}」`, <RaciRolesList roles={latest} showProject />);
      }
    });
  }

  /** 退出组：身上有 R 或 A 时不能退出；管理组最后一位组长不能退出 */
  async function leave(me: GroupMember) {
    setMenuFor(null);
    const roles = await repositories.groups.memberTaskRoles(group.id, me.userId);
    if (roles.some((r) => r.role === 'R' || r.role === 'A')) {
      await alert('不能退出', <RaciRolesList roles={roles} showProject />);
      return;
    }
    if (
      !GROUP_KIND_CONFIG[group.kind].everyoneLeader &&
      me.role === 'leader' &&
      !members.some((m) => !m.isMe && m.role === 'leader')
    ) {
      await alert('最后一位组长不能退出');
      return;
    }
    const ci = roles.filter((r) => r.role === 'C' || r.role === 'I');
    const ok = await confirm({
      message: `退出「${group.name}」？`,
      detail: ci.length > 0 ? <RaciRolesList roles={ci} showProject /> : undefined,
      confirmLabel: '退出',
      cancelLabel: '取消',
      destructive: true,
    });
    if (!ok) return;
    try {
      const result = await repositories.groups.leave(group.id);
      if (result === 'blocked') {
        const latest = await repositories.groups.memberTaskRoles(group.id, me.userId);
        await alert('不能退出', <RaciRolesList roles={latest} showProject />);
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

  const showRoles = !GROUP_KIND_CONFIG[group.kind].everyoneLeader;

  return (
    <RosterFrame title={group.name} onClose={onClose}>
      {permissions?.invite && (
        <EmailForm
          label="邀请"
          submitLabel="邀请"
          onSubmit={async (email) => {
            const result: InviteResult = await repositories.groups.invite(group.id, email);
            return { message: INVITE_MESSAGES[result], done: result === 'invited' };
          }}
        />
      )}
      <ul className="roster-list" aria-label="成员">
        {members.map((member) => {
          const actions = groupMemberActions(group.kind, group.myRole, member);
          const open = menuFor === member.userId;
          return (
            <RosterRow
              key={member.userId}
              person={member}
              roleLabel={showRoles ? ROLE_LABELS[member.role] : null}
              open={open}
              onToggle={() => setMenuFor(open ? null : member.userId)}
              actions={[
                actions.appointLeader && (
                  <button key="leader" type="button" onClick={() => void appointLeader(member)}>
                    任命为组长
                  </button>
                ),
                actions.remove && (
                  <button
                    key="remove"
                    type="button"
                    className="roster-danger"
                    onClick={() => void remove(member)}
                  >
                    踢出
                  </button>
                ),
                member.isMe && (
                  <button
                    key="leave"
                    type="button"
                    className="roster-danger"
                    onClick={() => void leave(member)}
                  >
                    退出组
                  </button>
                ),
              ]}
            />
          );
        })}
      </ul>
      {error && <p className="field-error">{error}</p>}
    </RosterFrame>
  );
}

/* ------------------------------------------------------------------ */
/* 项目名单                                                             */
/* ------------------------------------------------------------------ */

/**
 * 项目名单（项目页面标题右边的按钮）：项目管理员往项目里加小组成员（直接加入）或用邮箱邀请组外的人
 * （对方在通知里同意后加入）、移出成员、添加和删除只有名字的人（开了任务分配）；
 * 组长还能任命 / 撤销管理员（管理组）。组长自动在每个项目里，不能被移出，也不能退出项目。
 */
export function ProjectRosterDialog({
  group,
  project,
  onClose,
}: {
  group: Group;
  project: Project;
  onClose: () => void;
}) {
  const repositories = useRepositories();
  const { reload } = useTaskData();
  const selection = useSelection();
  const { members: groupMembers, scopeOf, reloadRoster } = useCurrentGroup();
  const scope = scopeOf(project.id);
  const members = scope?.members ?? [];
  const contacts = scope?.contacts ?? [];
  const permissions = scope?.permissions;
  const assignment = scope?.features.raci ?? false;
  const router = useRouter();
  const { error, setError, menuFor, setMenuFor, run, alert, confirm } = useRosterActions(
    async () => {
      await Promise.all([reloadRoster(), reload()]);
    },
  );

  useEffect(() => {
    void reloadRoster();
  }, [reloadRoster]);

  async function setRole(member: ProjectMember, role: 'admin' | 'member') {
    setMenuFor(null);
    const ok = await confirm({
      message:
        role === 'admin'
          ? `任命「${member.nickname}」为管理员？`
          : `撤销「${member.nickname}」的管理员？`,
      confirmLabel: role === 'admin' ? '任命' : '撤销',
      cancelLabel: '取消',
      destructive: role === 'member',
    });
    if (ok) await run(() => repositories.projects.setRole(project.id, member.userId, role));
  }

  /**
   * 移出项目：开了任务分配、他身上有 R 或 A 时不能移出，列出他在这个项目里的 RACI；
   * 否则确认窗口里列出会一起去掉的 C、I。没开任务分配时直接确认。
   */
  async function remove(member: ProjectMember) {
    setMenuFor(null);
    let detail: ReactNode;
    if (assignment) {
      const roles = await repositories.projects.memberTaskRoles(project.id, member.userId);
      if (roles.some((r) => r.role === 'R' || r.role === 'A')) {
        await alert(`不能移出「${member.nickname}」`, <RaciRolesList roles={roles} />);
        return;
      }
      const ci = roles.filter((r) => r.role === 'C' || r.role === 'I');
      if (ci.length > 0) detail = <RaciRolesList roles={ci} />;
    }
    const ok = await confirm({
      message: `把「${member.nickname}」移出项目？`,
      detail,
      confirmLabel: '移出',
      cancelLabel: '取消',
      destructive: true,
    });
    if (!ok) return;
    await run(async () => {
      if ((await repositories.projects.removeMember(project.id, member.userId)) === 'blocked') {
        const latest = await repositories.projects.memberTaskRoles(project.id, member.userId);
        await alert(`不能移出「${member.nickname}」`, <RaciRolesList roles={latest} />);
      }
    });
  }

  async function leave(me: ProjectMember) {
    setMenuFor(null);
    let detail: ReactNode;
    if (assignment) {
      const roles = await repositories.projects.memberTaskRoles(project.id, me.userId);
      if (roles.some((r) => r.role === 'R' || r.role === 'A')) {
        await alert('不能退出', <RaciRolesList roles={roles} />);
        return;
      }
      const ci = roles.filter((r) => r.role === 'C' || r.role === 'I');
      if (ci.length > 0) detail = <RaciRolesList roles={ci} />;
    }
    const ok = await confirm({
      message: `退出「${project.name}」？`,
      detail,
      confirmLabel: '退出',
      cancelLabel: '取消',
      destructive: true,
    });
    if (!ok) return;
    try {
      if ((await repositories.projects.leave(project.id)) === 'blocked') {
        const latest = await repositories.projects.memberTaskRoles(project.id, me.userId);
        await alert('不能退出', <RaciRolesList roles={latest} />);
        return;
      }
      onClose();
      // 退出项目后：还在组里就回到组页面，否则回到总览
      router.replace(group.myRole ? groupHref(selection, group.id) : '/', { scroll: false });
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function removeContact(contact: ProjectContact) {
    const ok = await confirm({
      message: `删除「${contact.name}」？`,
      confirmLabel: '删除',
      cancelLabel: '取消',
      destructive: true,
    });
    if (ok) await run(() => repositories.projects.removeContact(contact.id));
  }

  // 还不在项目里的小组成员：可以直接加入
  const addable = groupMembers.filter((m) => !members.some((p) => p.userId === m.userId));
  const showRoles = GROUP_KIND_CONFIG[group.kind].projectAdmins;

  return (
    <RosterFrame title={project.name} onClose={onClose}>
      {permissions?.manageMembers && addable.length > 0 && (
        <AddGroupMemberForm
          members={addable}
          onAdd={(userId) => run(() => repositories.projects.addMember(project.id, userId))}
        />
      )}
      {permissions?.manageMembers && (
        <EmailForm
          label="邀请"
          submitLabel="邀请"
          onSubmit={async (email) => {
            const result = await repositories.projects.invite(project.id, email);
            if (result === 'added') await Promise.all([reloadRoster(), reload()]);
            return {
              message: INVITE_MESSAGES[result],
              done: result === 'invited' || result === 'added',
            };
          }}
        />
      )}
      {permissions?.manageContacts && (
        <AddContactForm
          onAdd={(name) => run(() => repositories.projects.addContact(project.id, name))}
        />
      )}

      <ul className="roster-list" aria-label="成员">
        {members.map((member) => {
          const actions = projectMemberActions(group.kind, project.myRole, member);
          const open = menuFor === member.userId;
          return (
            <RosterRow
              key={member.userId}
              person={member}
              roleLabel={showRoles ? ROLE_LABELS[member.role] : null}
              open={open}
              onToggle={() => setMenuFor(open ? null : member.userId)}
              actions={[
                actions.appointAdmin && (
                  <button key="admin" type="button" onClick={() => void setRole(member, 'admin')}>
                    任命为管理员
                  </button>
                ),
                actions.revokeAdmin && (
                  <button key="revoke" type="button" onClick={() => void setRole(member, 'member')}>
                    撤销管理员
                  </button>
                ),
                actions.remove && (
                  <button
                    key="remove"
                    type="button"
                    className="roster-danger"
                    onClick={() => void remove(member)}
                  >
                    移出项目
                  </button>
                ),
                member.isMe && permissions?.leave && (
                  <button
                    key="leave"
                    type="button"
                    className="roster-danger"
                    onClick={() => void leave(member)}
                  >
                    退出项目
                  </button>
                ),
              ]}
            />
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
    </RosterFrame>
  );
}

/** 用邮箱邀请（组：邀请进组；项目：小组成员直接加入，组外的人收到邀请） */
function EmailForm({
  label,
  submitLabel,
  onSubmit,
}: {
  label: string;
  submitLabel: string;
  onSubmit: (email: string) => Promise<{ message: string; done: boolean }>;
}) {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = email.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      const result = await onSubmit(value);
      setMessage(`${result.message}：${value.toLowerCase()}`);
      if (result.done) setEmail('');
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="roster-form" aria-label={label} onSubmit={submit}>
      <div className="roster-form-row">
        <input
          type="email"
          aria-label="邀请的邮箱"
          placeholder="邮箱"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setMessage(null);
          }}
        />
        <button type="submit" className="button-primary" disabled={busy || !email.trim()}>
          {submitLabel}
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

/** 把小组成员加进项目：选一个人，直接加入 */
function AddGroupMemberForm({
  members,
  onAdd,
}: {
  members: readonly GroupMember[];
  onAdd: (userId: string) => Promise<void>;
}) {
  const [userId, setUserId] = useState('');
  return (
    <form
      className="roster-form"
      aria-label="加入项目"
      onSubmit={(event) => {
        event.preventDefault();
        if (!userId) return;
        void onAdd(userId).then(() => setUserId(''));
      }}
    >
      <div className="roster-form-row">
        <select
          aria-label="小组成员"
          className="roster-select"
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
        >
          <option value="">—</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.nickname}
            </option>
          ))}
        </select>
        <button type="submit" className="button-primary" disabled={!userId}>
          加入
        </button>
      </div>
    </form>
  );
}

function AddContactForm({ onAdd }: { onAdd: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');

  async function add(event: FormEvent) {
    event.preventDefault();
    const value = name.trim();
    if (!value) return;
    await onAdd(value);
    setName('');
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
    </form>
  );
}
