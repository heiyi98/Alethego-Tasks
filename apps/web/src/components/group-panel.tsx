'use client';

import type { Group, GroupMember } from '@alethego/core';
import type { GroupDeletionRequest, InviteResult } from '@alethego/data';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { useFeedback } from './feedback-provider';
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
 * 组的面板：点标题栏上的组名，在标题栏下方原地展开。
 * - 名单：每位成员在本组的昵称；自己的昵称点开原地编辑（清空 = 恢复成 TaskApp 名字）
 * - 邀请：输入邮箱（不发邮件，对方登录后在通知里看到）
 * - 删除组：发起后其他组长在通知里投票；只有自己一个人时直接删除
 */
export function GroupPanel({ group }: { group: Group }) {
  const repositories = useRepositories();
  const { reload } = useTaskData();
  const { confirm } = useFeedback();
  const router = useRouter();
  const [roster, setRoster] = useState<GroupMember[] | null>(null);
  const [deletion, setDeletion] = useState<GroupDeletionRequest | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [members, request] = await Promise.all([
        repositories.groups.roster(group.id),
        repositories.groups.deletionRequest(group.id),
      ]);
      setRoster(members);
      setDeletion(request);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [repositories, group.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function requestDeletion() {
    const ok = await confirm({
      message: `删除「${group.name}」？`,
      detail: '组和组里的全部任务都会被删除',
      confirmLabel: '删除',
      cancelLabel: '取消',
      destructive: true,
    });
    if (!ok) return;
    try {
      const result = await repositories.groups.requestDeletion(group.id);
      if (result === 'deleted') {
        router.replace('/', { scroll: false });
        await reload();
        return;
      }
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="group-panel" data-keep-panel>
      <section className="group-roster" aria-label="名单">
        {roster === null ? (
          <p className="muted">加载中…</p>
        ) : (
          <ul>
            {roster.map((member) =>
              member.isMe ? (
                <MyNickname
                  key={member.userId}
                  member={member}
                  onSave={async (nickname) => {
                    try {
                      await repositories.groups.setNickname(group.id, nickname);
                      await load();
                    } catch (e) {
                      setError(errorMessage(e));
                    }
                  }}
                />
              ) : (
                <li key={member.userId} className="group-member">
                  <span className="group-member-name">{member.nickname}</span>
                </li>
              ),
            )}
          </ul>
        )}
      </section>

      <InviteForm groupId={group.id} />

      <div className="group-danger">
        {deletion ? (
          <p className="muted group-deletion-pending" role="status">
            删除投票进行中
          </p>
        ) : (
          <button type="button" className="button-danger" onClick={requestDeletion}>
            删除组
          </button>
        )}
      </div>

      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

/** 自己在本组的昵称：点开原地编辑，回车保存，Esc 放弃；清空 = 恢复成 TaskApp 名字 */
function MyNickname({
  member,
  onSave,
}: {
  member: GroupMember;
  onSave: (nickname: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(member.nickname);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function save() {
    setEditing(false);
    const nickname = draft.trim();
    if (nickname === member.nickname) return;
    void onSave(nickname || null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      save();
    } else if (event.key === 'Escape') {
      setDraft(member.nickname);
      setEditing(false);
    }
  }

  return (
    <li className="group-member group-member-me">
      {editing ? (
        <input
          ref={inputRef}
          className="task-title-input group-nickname-input"
          aria-label="我在本组的昵称"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={save}
        />
      ) : (
        <button
          type="button"
          className="group-member-name group-nickname"
          aria-label={`我在本组的昵称：${member.nickname}`}
          onClick={() => {
            setDraft(member.nickname);
            setEditing(true);
          }}
        >
          {member.nickname}
        </button>
      )}
    </li>
  );
}

function InviteForm({ groupId }: { groupId: string }) {
  const repositories = useRepositories();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function invite() {
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
    <form
      className="group-invite"
      aria-label="邀请"
      onSubmit={(event) => {
        event.preventDefault();
        void invite();
      }}
    >
      <div className="group-invite-row">
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
          邀请
        </button>
      </div>
      {message && (
        <p className="muted group-invite-message" role="status">
          {message}
        </p>
      )}
    </form>
  );
}
