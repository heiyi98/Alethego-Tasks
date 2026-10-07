'use client';

import {
  DEFAULT_CATEGORY_PALETTE,
  PROJECT_TOOLS,
  TOOL_LABELS,
  defaultPaletteColor,
  type Group,
  type GroupMember,
  type Project,
  type ProjectTool,
} from '@alethego/core';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { useFeedback } from './feedback-provider';
import { ColorSwatches } from './group-form';
import { CheckIcon, IconButton, TrashIcon, XIcon } from './icons';
import { useRepositories } from './repositories-provider';
import { useUnsavedChanges } from './unsaved-changes';
import { errorMessage } from '@/lib/format';

/** 工具箱：多选，也可以都不选；建好后不能改（编辑时只显示，不能改） */
export function ToolboxField({
  tools,
  value,
  onChange,
  disabled = false,
}: {
  tools: readonly ProjectTool[];
  value: readonly ProjectTool[];
  onChange?: (next: ProjectTool[]) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="form-checks" aria-label="工具箱" disabled={disabled}>
      {tools.map((tool) => (
        <label key={tool} className="form-check">
          <input
            type="checkbox"
            checked={value.includes(tool)}
            onChange={(event) =>
              onChange?.(event.target.checked ? [...value, tool] : value.filter((t) => t !== tool))
            }
          />
          {TOOL_LABELS[tool]}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * 新建项目（只有组长；侧边栏组下面的"新建项目"）：名字、颜色、工具箱（多选）、项目成员。
 * 项目成员从组里所有人里选，默认全选，可以去掉；组长自动在每个项目里，不能去掉。
 */
export function NewProjectForm({
  group,
  projects,
  onCancel,
  onCreated,
}: {
  group: Group;
  projects: readonly Project[];
  onCancel: () => void;
  onCreated: (project: Project) => void | Promise<void>;
}) {
  const repositories = useRepositories();
  const [name, setName] = useState('');
  const [color, setColor] = useState(() => defaultPaletteColor(projects.map((p) => p.color)));
  const [tools, setTools] = useState<ProjectTool[]>([]);
  const [roster, setRoster] = useState<GroupMember[] | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useUnsavedChanges(formRef, () => name.trim() !== '' || tools.length > 0, onCancel);

  useEffect(() => {
    let cancelled = false;
    repositories.groups
      .roster(group.id)
      .then((members) => !cancelled && setRoster(members))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [repositories, group.id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError('项目名不能为空');
      return;
    }
    if (busy || !roster) return;
    setBusy(true);
    try {
      const project = await repositories.projects.create({
        groupId: group.id,
        name,
        color,
        tools: PROJECT_TOOLS.filter((t) => tools.includes(t)),
        memberIds: roster
          .filter((m) => m.role !== 'leader' && !excluded.has(m.userId))
          .map((m) => m.userId),
      });
      await onCreated(project);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      ref={formRef}
      className="category-form group-form"
      aria-label="新建项目"
      onSubmit={submit}
      onKeyDown={(event) => event.key === 'Escape' && onCancel()}
    >
      <input
        aria-label="项目名"
        placeholder="项目名"
        value={name}
        autoFocus
        onChange={(event) => {
          setName(event.target.value);
          setError(null);
        }}
      />
      <ColorSwatches value={color} onChange={setColor} label="项目的颜色" />
      <ToolboxField tools={PROJECT_TOOLS} value={tools} onChange={setTools} />
      {roster && (
        <fieldset className="form-checks form-checks-column" aria-label="项目成员">
          {roster.map((member) => {
            const leader = member.role === 'leader';
            return (
              <label key={member.userId} className="form-check">
                <input
                  type="checkbox"
                  checked={leader || !excluded.has(member.userId)}
                  disabled={leader}
                  onChange={(event) => {
                    const next = new Set(excluded);
                    if (event.target.checked) next.delete(member.userId);
                    else next.add(member.userId);
                    setExcluded(next);
                  }}
                />
                {member.nickname}
              </label>
            );
          })}
        </fieldset>
      )}
      {error && <p className="field-error">{error}</p>}
      <div className="category-form-actions">
        <span className="spacer" />
        <IconButton label="取消" onClick={onCancel}>
          <XIcon />
        </IconButton>
        <IconButton
          label="创建项目"
          type="submit"
          className="icon-button-primary"
          disabled={busy || !roster}
        >
          <CheckIcon />
        </IconButton>
      </div>
    </form>
  );
}

/**
 * 编辑项目（只有组长；侧边栏项目旁边的铅笔）：改名字和颜色、发起删除项目（投票）；工具箱不能改。
 */
export function EditProjectForm({
  project,
  onCancel,
  onSaved,
  onDeleted,
}: {
  project: Project;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
  onDeleted: () => void | Promise<void>;
}) {
  const repositories = useRepositories();
  const { confirm } = useFeedback();
  const [name, setName] = useState(project.name);
  const [color, setColor] = useState(project.color ?? DEFAULT_CATEGORY_PALETTE[0]!);
  const [deletionPending, setDeletionPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useUnsavedChanges(
    formRef,
    () => name.trim() !== project.name || color !== (project.color ?? DEFAULT_CATEGORY_PALETTE[0]),
    onCancel,
  );

  useEffect(() => {
    let cancelled = false;
    repositories.projects
      .deletionRequest(project.id)
      .then((request) => !cancelled && setDeletionPending(request !== null))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [repositories, project.id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError('项目名不能为空');
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      if (name.trim() !== project.name || color !== project.color) {
        await repositories.projects.update(project.id, { name, color });
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
      message: `删除「${project.name}」？`,
      detail: '项目和项目里的全部任务都会被删除',
      confirmLabel: '删除',
      cancelLabel: '取消',
      destructive: true,
    });
    if (!ok) return;
    try {
      const result = await repositories.projects.requestDeletion(project.id);
      if (result === 'deleted') await onDeleted();
      else setDeletionPending(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <form
      ref={formRef}
      className="category-form group-form"
      aria-label={`编辑项目「${project.name}」`}
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !document.querySelector('[data-dialog-open]')) onCancel();
      }}
    >
      <input
        aria-label="项目名"
        placeholder="项目名"
        value={name}
        autoFocus
        onChange={(event) => {
          setName(event.target.value);
          setError(null);
        }}
      />
      <ColorSwatches value={color} onChange={setColor} label="项目的颜色" />
      <ToolboxField tools={PROJECT_TOOLS} value={project.tools} disabled />
      {deletionPending && (
        <p className="muted group-deletion-pending" role="status">
          删除投票进行中
        </p>
      )}
      {error && <p className="field-error">{error}</p>}
      <div className="category-form-actions">
        {!deletionPending && (
          <IconButton label="删除项目" className="icon-button-danger" onClick={requestDeletion}>
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
