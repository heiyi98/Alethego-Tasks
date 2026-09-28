'use client';

import {
  DEFAULT_CATEGORY_PALETTE,
  isColorTaken,
  isHexColor,
  nextAvailablePaletteColor,
  normalizeColor,
  type Category,
} from '@alethego/core';
import { DataError } from '@alethego/data';
import { useState, type FormEvent } from 'react';

import { useFeedback } from './feedback-provider';
import { CheckIcon, IconButton, TrashIcon, WarningIcon, XIcon } from './icons';
import { useRepositories } from './repositories-provider';
import { errorMessage } from '@/lib/format';

/** 调色板用尽时的默认值：随机取一个未被使用的颜色（不因颜色不足限制分类数量） */
function randomUnusedColor(used: readonly string[]): string {
  for (;;) {
    const color = `#${Math.floor(Math.random() * 0xffffff)
      .toString(16)
      .padStart(6, '0')
      .toUpperCase()}`;
    if (!isColorTaken(color, used)) return color;
  }
}

/**
 * 分类表单（新建与编辑共用）：名称 + 描述 + 颜色。颜色可以从默认调色板挑，也可以自选任意颜色；
 * 同一用户的分类颜色不能重复：已被其他分类占用的色块不可选，自选颜色撞色时立即提示。
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
  const others = categories.filter((c) => c.id !== category?.id);
  const used = others.map((c) => c.color);
  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [color, setColor] = useState(
    () => category?.color ?? nextAvailablePaletteColor(used) ?? randomUnusedColor(used),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const ownerOf = (value: string) =>
    others.find((c) => normalizeColor(c.color) === normalizeColor(value));
  const isPalette = DEFAULT_CATEGORY_PALETTE.some(
    (c) => normalizeColor(c) === normalizeColor(color),
  );
  const colorOwner = ownerOf(color);

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
    if (isColorTaken(color, used)) return; // 撞色提示已在颜色下方显示
    setSaving(true);
    try {
      const input = { name: trimmed, description: description.trim(), color };
      const saved = category
        ? await repositories.categories.update(category.id, input)
        : await repositories.categories.create(input);
      await onSaved(saved);
    } catch (e) {
      setError(
        e instanceof DataError && e.code === 'conflict'
          ? '该颜色已被其他分类使用，请换一个'
          : `${category ? '保存' : '创建'}失败：${errorMessage(e)}`,
      );
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
          const owner = ownerOf(swatch);
          const selected = normalizeColor(color) === normalizeColor(swatch);
          return (
            <button
              key={swatch}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={owner ? `${swatch}（已被「${owner.name}」使用）` : swatch}
              disabled={Boolean(owner)}
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
      {colorOwner && (
        <p className="field-warning" role="alert">
          <WarningIcon size={14} />
          该颜色已被「{colorOwner.name}」使用，请换一个
        </p>
      )}
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
          disabled={saving || Boolean(colorOwner)}
        >
          <CheckIcon />
        </IconButton>
      </div>
    </form>
  );
}
