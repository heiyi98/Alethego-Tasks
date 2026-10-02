import type { ProjectTool } from './group';

/** 分类：与任务多对多（通过 task_categories 关联）。不同分类可以用同一个颜色。 */
export interface Category {
  id: string;
  ownerId: string;
  name: string;
  /** #RRGGBB */
  color: string;
  /** 分类描述，可为空字符串 */
  description: string;
  /** 工具箱：建分类时选（只有"任务关系"），之后不能改 */
  tools: ProjectTool[];
  createdAt: Date;
}

/**
 * 起步九色调色板：红黄蓝、橙绿紫、粉棕青，取 Apple Human Interface Guidelines 的系统色（浅色外观）。
 * 用户也可以自选任意颜色；不同分类（以及不同的组）可以用同一个颜色。
 */
export const DEFAULT_CATEGORY_PALETTE = [
  '#FF3B30', // systemRed 红
  '#FFCC00', // systemYellow 黄
  '#007AFF', // systemBlue 蓝
  '#FF9500', // systemOrange 橙
  '#34C759', // systemGreen 绿
  '#AF52DE', // systemPurple 紫
  '#FF2D55', // systemPink 粉
  '#A2845E', // systemBrown 棕
  '#32ADE6', // systemCyan 青
] as const;

/** 颜色是否已被使用（不区分大小写） */
export function isColorTaken(color: string, usedColors: Iterable<string>): boolean {
  const target = normalizeColor(color);
  for (const used of usedColors) if (normalizeColor(used) === target) return true;
  return false;
}

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

/**
 * 新建分类 / 组时的默认颜色：调色板里还没用过的第一个；全都用过了就从头开始依次轮换
 * （按已用的个数取，第 10 个取第 1 个，第 11 个取第 2 个……）。
 */
export function defaultPaletteColor(usedColors: readonly string[]): string {
  return (
    nextAvailablePaletteColor(usedColors) ??
    DEFAULT_CATEGORY_PALETTE[usedColors.length % DEFAULT_CATEGORY_PALETTE.length]!
  );
}
