import type { StatusFilter } from '@alethego/core';

import { DEFAULT_STATUS, STATUS_ORDER } from './format';

/**
 * 左侧菜单的选择：一项状态（单选）+ 若干分类（多选，一个都不选 = 所有分类）。
 * 清单模式（/）与矩阵模式（/matrix）共用同一套选择，保存在 URL 查询参数里：
 * ?status=todo&cat=id1,id2（status 为默认值"全部"时省略）。
 */

export type ViewMode = 'list' | 'matrix';

export interface Selection {
  mode: ViewMode;
  status: StatusFilter;
  categoryIds: string[];
}

/** 矩阵上有对应内容的状态；已完成 / 已错过只能在清单中查看 */
export const MATRIX_STATUSES: readonly StatusFilter[] = ['all', 'starred', 'todo'];

export function isStatusFilter(value: string | null | undefined): value is StatusFilter {
  return STATUS_ORDER.some((status) => status === value);
}

export function modeOfPath(pathname: string): ViewMode {
  return pathname.startsWith('/matrix') ? 'matrix' : 'list';
}

export function parseSelection(pathname: string, params: URLSearchParams): Selection {
  const status = params.get('status');
  return {
    mode: modeOfPath(pathname),
    status: isStatusFilter(status) ? status : DEFAULT_STATUS,
    categoryIds: params.get('cat')?.split(',').filter(Boolean) ?? [],
  };
}

/** 选择 → URL。矩阵模式下选了已完成 / 已错过时自动切回清单 */
export function selectionHref(selection: Selection): string {
  const mode =
    selection.mode === 'matrix' && !MATRIX_STATUSES.includes(selection.status)
      ? 'list'
      : selection.mode;
  const params = new URLSearchParams();
  if (selection.status !== DEFAULT_STATUS) params.set('status', selection.status);
  if (selection.categoryIds.length > 0) params.set('cat', selection.categoryIds.join(','));
  const query = params.toString();
  const path = mode === 'matrix' ? '/matrix' : '/';
  return query ? `${path}?${query}` : path;
}

export function toggleCategory(selection: Selection, categoryId: string): Selection {
  const categoryIds = selection.categoryIds.includes(categoryId)
    ? selection.categoryIds.filter((id) => id !== categoryId)
    : [...selection.categoryIds, categoryId];
  return { ...selection, categoryIds };
}
