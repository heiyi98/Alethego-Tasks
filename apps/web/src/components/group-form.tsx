'use client';

import {
  CREATABLE_GROUP_KINDS,
  DEFAULT_CATEGORY_PALETTE,
  GROUP_KIND_LABELS,
  defaultPaletteColor,
  normalizeColor,
  type Group,
  type GroupKind,
} from '@alethego/core';
import { useEffect, useState, type FormEvent } from 'react';

import { useFeedback } from './feedback-provider';
import { CheckIcon, IconButton, TrashIcon, XIcon } from './icons';
import { useRepositories } from './repositories-provider';
import { errorMessage } from '@/lib/format';

/** 颜色：和分类一样的调色板，也可以自选 */
function ColorSwatches({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const isPalette = DEFAULT_CATEGORY_PALETTE.some(
    (c) => normalizeColor(c) === normalizeColor(value),
  );
  return (
    <div className="swatches" role="radiogroup" aria-label="组的颜色">
      {DEFAULT_CATEGORY_PALETTE.map((swatch) => (
        <button
          key={swatch}
          type="button"
          role="radio"
          aria-checked={normalizeColor(value) === normalizeColor(swatch)}
          aria-label={swatch}
          className="swatch"
          style={{ backgroundColor: swatch }}
          onClick={() => onChange(swatch)}
        />
      ))}
      <label
        className={`swatch swatch-custom${!isPalette ? ' swatch-custom-selected' : ''}`}
        style={!isPalette ? { backgroundColor: value } : undefined}
      >
        <input
          type="color"
          aria-label="自选颜色"
          value={value.toLowerCase()}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
        />
      </label>
    </div>
  );
}

/** 新建组：组名、类型（建好后不能改）、颜色 */
export function NewGroupForm({
  groups,
  onCancel,
  onCreated,
}: {
  groups: readonly Group[];
  onCancel: () => void;
  onCreated: (group: Group) => void | Promise<void>;
}) {
  const repositories = useRepositories();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<GroupKind>('cooperative');
  const [color, setColor] = useState(() =>
    defaultPaletteColor(groups.flatMap((g) => (g.color ? [g.color] : []))),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError('组名不能为空');
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await onCreated(await repositories.groups.create({ name, kind, color }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="category-form group-form"
      aria-label="新建组"
      onSubmit={submit}
      onKeyDown={(event) => event.key === 'Escape' && onCancel()}
    >
      <input
        aria-label="组名"
        placeholder="组名"
        value={name}
        autoFocus
        onChange={(event) => {
          setName(event.target.value);
          setError(null);
        }}
      />
      <div className="mini-segmented group-kind" role="radiogroup" aria-label="组的类型">
        {CREATABLE_GROUP_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
          >
            {GROUP_KIND_LABELS[k]}
          </button>
        ))}
      </div>
      <ColorSwatches value={color} onChange={setColor} />
      {error && <p className="field-error">{error}</p>}
      <div className="category-form-actions">
        <span className="spacer" />
        <IconButton label="取消" onClick={onCancel}>
          <XIcon />
        </IconButton>
        <IconButton label="创建组" type="submit" className="icon-button-primary" disabled={busy}>
          <CheckIcon />
        </IconButton>
      </div>
    </form>
  );
}

/**
 * 编辑组（侧边栏里组旁边的铅笔，和分类一样的原地表单）：
 * - 组名和颜色：只有组长能改
 * - 我在本组的昵称：每个人都能改自己的（清空 = 恢复成 TaskApp 名字）
 * - 删除组：只有组长能看到，走投票流程
 */
export function EditGroupForm({
  group,
  onCancel,
  onSaved,
  onDeleted,
}: {
  group: Group;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
  onDeleted: () => void | Promise<void>;
}) {
  const repositories = useRepositories();
  const { confirm } = useFeedback();
  const leader = group.myRole === 'leader';
  const [name, setName] = useState(group.name);
  const [color, setColor] = useState(group.color ?? DEFAULT_CATEGORY_PALETTE[0]!);
  const [nickname, setNickname] = useState<string | null>(null);
  const [savedNickname, setSavedNickname] = useState<string | null>(null);
  const [deletionPending, setDeletionPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [roster, deletion] = await Promise.all([
          repositories.groups.roster(group.id),
          repositories.groups.deletionRequest(group.id),
        ]);
        if (cancelled) return;
        const me = roster.find((m) => m.isMe);
        const current = me?.hasCustomNickname ? me.nickname : '';
        setNickname(current);
        setSavedNickname(current);
        setDeletionPending(deletion !== null);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repositories, group.id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (leader && !name.trim()) {
      setError('组名不能为空');
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      if (leader && (name.trim() !== group.name || color !== group.color)) {
        await repositories.groups.update(group.id, { name, color });
      }
      if (nickname !== null && nickname.trim() !== (savedNickname ?? '').trim()) {
        await repositories.groups.setNickname(group.id, nickname.trim() || null);
      }
      await onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

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
      if (result === 'deleted') await onDeleted();
      else setDeletionPending(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <form
      className="category-form group-form"
      aria-label={`编辑组「${group.name}」`}
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !document.querySelector('[data-dialog-open]')) onCancel();
      }}
    >
      {leader && (
        <>
          <input
            aria-label="组名"
            placeholder="组名"
            value={name}
            autoFocus
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
          />
          <ColorSwatches value={color} onChange={setColor} />
        </>
      )}
      <input
        aria-label="我在本组的昵称"
        placeholder="我在本组的昵称"
        value={nickname ?? ''}
        disabled={nickname === null}
        autoFocus={!leader}
        onChange={(event) => setNickname(event.target.value)}
      />
      {deletionPending && (
        <p className="muted group-deletion-pending" role="status">
          删除投票进行中
        </p>
      )}
      {error && <p className="field-error">{error}</p>}
      <div className="category-form-actions">
        {leader && !deletionPending && (
          <IconButton label="删除组" className="icon-button-danger" onClick={requestDeletion}>
            <TrashIcon />
          </IconButton>
        )}
        <span className="spacer" />
        <IconButton label="取消" onClick={onCancel}>
          <XIcon />
        </IconButton>
        <IconButton label="保存" type="submit" className="icon-button-primary" disabled={busy}>
          <CheckIcon />
        </IconButton>
      </div>
    </form>
  );
}
