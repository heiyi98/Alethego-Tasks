/** 分类：与任务多对多（通过 task_categories 关联），颜色在同一用户的分类集合内排他。 */
export interface Category {
  id: string;
  ownerId: string;
  name: string;
  /** #RRGGBB */
  color: string;
  createdAt: Date;
}

/** 起步九色调色板：红黄蓝、橙绿紫、粉棕青。 */
export const DEFAULT_CATEGORY_PALETTE = [
  '#E53935', // 红
  '#FDD835', // 黄
  '#1E88E5', // 蓝
  '#FB8C00', // 橙
  '#43A047', // 绿
  '#8E24AA', // 紫
  '#EC407A', // 粉
  '#6D4C41', // 棕
  '#00ACC1', // 青
] as const;

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export function isHexColor(value: string): boolean {
  return HEX_COLOR.test(value);
}

export function normalizeColor(color: string): string {
  return color.toUpperCase();
}

/**
 * 从默认调色板中挑出第一个尚未被使用的颜色。
 * 调色板耗尽时返回 null——如何处理（自定义颜色等）由上层决定，不因此限制分类数量。
 */
export function nextAvailablePaletteColor(usedColors: Iterable<string>): string | null {
  const used = new Set(Array.from(usedColors, normalizeColor));
  return DEFAULT_CATEGORY_PALETTE.find((color) => !used.has(color)) ?? null;
}
