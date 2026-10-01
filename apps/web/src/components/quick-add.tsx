'use client';

import { normalizeTaskTitle, type Category } from '@alethego/core';
import { useState, type KeyboardEvent } from 'react';

import { useFeedback } from './feedback-provider';
import { IconButton, PlusIcon, XIcon } from './icons';
import { usePanels } from './panel-provider';
import { PanelSurface } from './panel-surface';
import { EditorTitleRow, QuickOptionsRow, StarButton, TaskEditor } from './task-editor';
import { useCreateTask } from './task-panels';
import { useTaskData } from './task-data-provider';
import {
  isDraftDirty,
  validateTaskForm,
  type FormErrors,
  type TaskFormValue,
} from '@/lib/task-form';

/**
 * 快速添加（每个清单页面都有）：输入栏本身就是标题，下方一行常用选项（重要性、截止日期 / 时刻），
 * 点输入栏右端的 ➕ 创建（回车是额外的快捷方式）；三角展开完整的新建面板，面板从输入栏下方延展出来。收起面板时草稿保留。
 * 新任务自动带上当前选中的全部分类（没选分类就不带）；在"收藏"里新建的任务自动标星。
 * 在组里：新任务属于这个组，没有重要性、分类和收藏。
 */
export function QuickAdd({
  categories,
  starred,
  groupId = null,
}: {
  categories: readonly Category[];
  /** 在"收藏"里：新任务默认标星 */
  starred: boolean;
  /** 当前所在的组；null = 个人 */
  groupId?: string | null;
}) {
  const { draft, setDraft, resetDraft, open, close, isOpen } = usePanels();
  const { data, now, timeZone } = useTaskData();
  const { notify, confirm, showUndo } = useFeedback();
  const createTask = useCreateTask(groupId);
  const inGroup = groupId !== null;
  const [errors, setErrors] = useState<FormErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const defaultCategoryIds = categories.map((c) => c.id);
  const expanded = isOpen({ kind: 'create' });
  const defaults = {
    categoryIds: inGroup ? [] : defaultCategoryIds,
    isStarred: inGroup ? false : starred,
  };
  const form: TaskFormValue = {
    ...draft,
    categoryIds: draft.categoryIds ?? defaults.categoryIds,
    isStarred: draft.isStarred ?? defaults.isStarred,
  };

  const onChange = (patch: Partial<TaskFormValue>) => {
    setErrors({});
    setMessage(null);
    setDraft((d) => ({ ...d, ...patch }));
  };

  async function submit() {
    if (!normalizeTaskTitle(form.title) || busy) {
      if (expanded) setErrors(validateTaskForm(form));
      return;
    }
    const found = validateTaskForm(form);
    if (Object.keys(found).length > 0) {
      // 草稿里有不合法的内容（例如不完整的重复规则）：展开面板显示错误
      setErrors(found);
      open({ kind: 'create' });
      return;
    }
    setBusy(true);
    const result = await createTask(form);
    setBusy(false);
    // 创建失败时保留草稿，显示原因；已创建（哪怕部分信息失败）则清空草稿，避免重复创建
    if (!result.created) {
      setMessage(result.message ?? null);
      return;
    }
    resetDraft();
    close();
    if (result.message) notify(result.message);
  }

  async function discard() {
    if (isDraftDirty(form, defaults)) {
      const ok = await confirm({
        message: '放弃这个新任务？',
        detail: '已填写的内容将被丢弃',
        confirmLabel: '放弃',
        cancelLabel: '继续编辑',
        destructive: true,
      });
      if (!ok) return;
    }
    resetDraft();
    close();
  }

  function removePerson(index: number) {
    const removed = form.people[index];
    if (!removed) return;
    onChange({ people: form.people.filter((_, i) => i !== index) });
    if (removed.name.trim() || removed.relation.trim()) {
      showUndo(`已删除人物「${removed.name || removed.relation}」`, () =>
        setDraft((d) => {
          const people = [...d.people];
          people.splice(Math.min(index, people.length), 0, removed);
          return { ...d, people };
        }),
      );
    }
  }

  const onEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  const star = !inGroup && (
    <StarButton
      starred={form.isStarred}
      onToggle={() => onChange({ isStarred: !form.isStarred })}
    />
  );
  const discardButton = (
    <IconButton label="放弃" onClick={discard}>
      <XIcon />
    </IconButton>
  );
  // 手机底部抽屉里自带一行标题：任务还没创建，右侧同样是 ➕
  const mobileActions = (
    <>
      {star}
      {discardButton}
      <CreateButton onClick={submit} />
    </>
  );

  return (
    <div
      className={`quick-add${expanded ? ' quick-add-expanded' : ''}`}
      role="form"
      aria-label={expanded ? '新建任务' : '快速添加'}
    >
      {/* 输入栏这一行是独立组件：展开详情前后同一个元素、同样的尺寸和图标，详情挂在它下方 */}
      <QuickAddInputRow
        value={draft.title}
        onChange={(title) => onChange({ title })}
        onKeyDown={onEnter}
        onSubmit={submit}
      />
      {expanded ? (
        <PanelSurface variant="inline" label="新建任务" onClose={close}>
          <div
            onKeyDown={(event) =>
              event.key === 'Enter' &&
              event.target instanceof HTMLInputElement &&
              event.target.getAttribute('aria-label') === '标题' &&
              onEnter(event as KeyboardEvent<HTMLInputElement>)
            }
          >
            <TaskEditor
              value={form}
              onChange={onChange}
              errors={errors}
              categories={data?.categories ?? []}
              inGroup={inGroup}
              records={[]}
              now={now}
              timeZone={timeZone}
              fallbackStart={null}
              onToggle={close}
              onRemovePerson={removePerson}
              optionsActions={
                <>
                  {star}
                  {discardButton}
                </>
              }
              titleRow={
                <EditorTitleRow
                  className="mobile-only"
                  placeholder="新任务"
                  value={form.title}
                  onChange={(title) => onChange({ title })}
                  actions={mobileActions}
                />
              }
            />
            {message && <p className="field-error">{message}</p>}
          </div>
        </PanelSurface>
      ) : (
        <>
          <QuickOptionsRow
            value={form}
            onChange={onChange}
            expanded={false}
            onToggle={() => open({ kind: 'create' })}
            toggleLabel="展开完整选项"
            inGroup={inGroup}
          />
          {message && <p className="field-error">{message}</p>}
        </>
      )}
    </div>
  );
}

/** 还没创建的任务：右侧是 ➕，点击创建 */
function CreateButton({ onClick }: { onClick: () => void }) {
  return (
    <IconButton label="创建" className="icon-button-primary quick-add-submit" onClick={onClick}>
      <PlusIcon />
    </IconButton>
  );
}

/**
 * 快速添加的输入栏这一行：左边没有图标，右边是 ➕（任务还没创建）。
 * 展开详情前后都是这一个组件、同一个位置，尺寸和图标不变；带 data-keep-panel，点它不会收起展开的详情。
 */
function QuickAddInputRow({
  value,
  onChange,
  onKeyDown,
  onSubmit,
}: {
  value: string;
  onChange: (title: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="quick-add-input" data-keep-panel>
      <input
        aria-label="快速添加任务"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
      />
      <CreateButton onClick={onSubmit} />
    </div>
  );
}
