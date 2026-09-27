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
 * 新建分类：名称 + 颜色。颜色可以从默认调色板挑，也可以自选任意颜色；
 * 同一用户的分类颜色不能重复（已被占用的色块不可选，自选颜色撞色时提示）。
 */
export function CategoryCreateForm({
  categories,
  onCreated,
  onCancel,
}: {
  categories: readonly Category[];
  onCreated: (category: Category) => void | Promise<void>;
  onCancel: () => void;
}) {
  const repositories = useRepositories();
  const used = categories.map((c) => c.color);
  const [name, setName] = useState('');
  const [color, setColor] = useState(
    () => nextAvailablePaletteColor(used) ?? randomUnusedColor(used),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const ownerOf = (value: string) =>
    categories.find((c) => normalizeColor(c.color) === normalizeColor(value));
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
    if (isColorTaken(color, used)) {
      setError(`该颜色已被「${ownerOf(color)?.name}」使用，请换一个`);
      return;
    }
    setSaving(true);
    try {
      const category = await repositories.categories.create({ name: trimmed, color });
      await onCreated(category);
    } catch (e) {
      setError(
        e instanceof DataError && e.code === 'conflict'
          ? '该颜色已被其他分类使用，请换一个'
          : `创建失败：${errorMessage(e)}`,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="category-form" onSubmit={handleSubmit} aria-label="新建分类">
      <input
        aria-label="新分类名称"
        placeholder="分类名称"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => event.key === 'Escape' && onCancel()}
        autoFocus
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
              title={owner ? `已被「${owner.name}」使用` : swatch}
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
          title="自选颜色"
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
      {error && <p className="field-error">{error}</p>}
      <div className="category-form-actions">
        <button type="button" className="button-plain" onClick={onCancel}>
          取消
        </button>
        <button type="submit" className="button-primary button-small" disabled={saving}>
          添加
        </button>
      </div>
    </form>
  );
}
