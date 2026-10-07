'use client';

import {
  CATEGORY_TOOLS,
  DEFAULT_CATEGORY_PALETTE,
  defaultPaletteColor,
  isHexColor,
  normalizeColor,
  type Category,
  type ProjectTool,
} from '@alethego/core';
import { useRef, useState, type FormEvent } from 'react';

import { useFeedback } from './feedback-provider';
import { CheckIcon, IconButton, TrashIcon, XIcon } from './icons';
import { ToolboxField } from './project-form';
import { useRepositories } from './repositories-provider';
import { useUnsavedChanges } from './unsaved-changes';
import { errorMessage } from '@/lib/format';

/**
 * 分类表单（新建与编辑共用）：名称 + 描述 + 颜色 + 工具箱（只有"任务关系"，建好后不能改）。颜色可以从默认调色板挑，也可以自选任意颜色；
 * 颜色可以和其他分类（以及组）相同；默认取调色板里还没用过的第一个，全都用过就从头轮换。
 * 编辑时可删除分类：只解除与任务的关联，任务本身保留（删除前确认一次）。
 */
export function CategoryForm({
  categories,
  category,
  onSaved,
  onCancel,
  onDeleted,
}: {
  categories: readonly Category[];
  /** 传入时为编辑模式 */
  category?: Category;
  onSaved: (category: Category) => void | Promise<void>;
  onCancel: () => void;
  onDeleted?: (category: Category) => void | Promise<void>;
}) {
  const repositories = useRepositories();
  const { confirm } = useFeedback();
  const used = categories.filter((c) => c.id !== category?.id).map((c) => c.color);
  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [color, setColor] = useState(() => category?.color ?? defaultPaletteColor(used));
  const [tools, setTools] = useState<ProjectTool[]>(() => [...(category?.tools ?? [])]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);
  const [initialColor] = useState(color);
  useUnsavedChanges(
    formRef,
    () =>
      name.trim() !== (category?.name ?? '') ||
      description.trim() !== (category?.description ?? '') ||
      color !== initialColor ||
      (!category && tools.length > 0),
    onCancel,
  );

  const isPalette = DEFAULT_CATEGORY_PALETTE.some(
    (c) => normalizeColor(c) === normalizeColor(color),
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('请输入分类名称');
      return;
    }
    if (!isHexColor(color)) {
      setError('请选择颜色');
      return;
    }
    setSaving(true);
    try {
      const input = { name: trimmed, description: description.trim(), color };
      const saved = category
        ? await repositories.categories.update(category.id, input)
        : await repositories.categories.create({
            ...input,
            tools: tools.filter((t): t is 'relations' => t === 'relations'),
          });
      await onSaved(saved);
    } catch (e) {
      setError(`${category ? '保存' : '创建'}失败：${errorMessage(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!category) return;
    const ok = await confirm({
      message: `删除分类「${category.name}」？`,
      detail: '任务会保留，只是不再属于这个分类',
      confirmLabel: '删除分类',
      cancelLabel: '取消',
      destructive: true,
    });
    if (!ok) return;
    try {
      await repositories.categories.delete(category.id);
      await onDeleted?.(category);
    } catch (e) {
      setError(`删除失败：${errorMessage(e)}`);
    }
  }

  const label = category ? `编辑分类「${category.name}」` : '新建分类';

  return (
    <form
      ref={formRef}
      className="category-form"
      onSubmit={handleSubmit}
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !document.querySelector('[data-dialog-open]')) onCancel();
      }}
    >
      <input
        aria-label="分类名称"
        placeholder="分类名称"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          setError(null);
        }}
        autoFocus
      />
      <textarea
        aria-label="分类描述"
        placeholder="描述（可选）"
        rows={2}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <div className="swatches" role="radiogroup" aria-label="分类颜色">
        {DEFAULT_CATEGORY_PALETTE.map((swatch) => {
          const selected = normalizeColor(color) === normalizeColor(swatch);
          return (
            <button
              key={swatch}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={swatch}
              className="swatch"
              style={{ backgroundColor: swatch }}
              onClick={() => {
                setColor(swatch);
                setError(null);
              }}
            />
          );
        })}
        <label
          className={`swatch swatch-custom${!isPalette ? ' swatch-custom-selected' : ''}`}
          style={!isPalette ? { backgroundColor: color } : undefined}
        >
          <input
            type="color"
            aria-label="自选颜色"
            value={color.toLowerCase()}
            onChange={(event) => {
              setColor(event.target.value.toUpperCase());
              setError(null);
            }}
          />
        </label>
      </div>
      <ToolboxField
        tools={CATEGORY_TOOLS}
        value={tools}
        onChange={setTools}
        disabled={category !== undefined}
      />
      {error && <p className="field-error">{error}</p>}
      <div className="category-form-actions">
        {category && (
          <IconButton label="删除分类" className="icon-button-danger" onClick={handleDelete}>
            <TrashIcon />
          </IconButton>
        )}
        <span className="spacer" />
        <IconButton label="取消" onClick={onCancel}>
          <XIcon />
        </IconButton>
        <IconButton
          label={category ? '保存分类' : '添加分类'}
          type="submit"
          className="icon-button-primary"
          disabled={saving}
        >
          <CheckIcon />
        </IconButton>
      </div>
    </form>
  );
}
