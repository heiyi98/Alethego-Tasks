import { DEFAULT_LIST_SCOPE, LIST_SCOPES, type ListScope, type StatusFilter } from '@alethego/core';

import { ALL_STATUSES, DEFAULT_STATUS } from './format';

/**
 * 当前的选择：
 * - 容器：个人（总览）、某一个组（?group=id，列出组里我能看到的所有项目的任务）或组里的某个项目
 *   （?group=id&project=id）。在组里时没有时间管理矩阵，范围和分类不起作用
 * - 范围（左侧菜单上区，单选）：全部 / 收藏
 * - 分类（左侧菜单下区，多选开关；一个都不选 = 所有分类）
 * - 状态（清单页面内、添加栏下面一行，单选；矩阵模式不使用）
 * 清单模式（/）与矩阵模式（/matrix）共用同一套选择，保存在 URL 查询参数里：
 * ?scope=starred&status=completed&cat=id1,id2（取默认值时省略）。
 */

/** 看法：清单 / 时间管理矩阵（个人）/ 责任分配矩阵（开了任务分配的项目，?view=raci） */
export type ViewMode = 'list' | 'matrix' | 'raci';

export interface Selection {
  mode: ViewMode;
  /** 当前所在的组；null = 个人 */
  groupId: string | null;
  /** 组里选中的项目；null = 整个组 */
  projectId: string | null;
  scope: ListScope;
  status: StatusFilter;
  categoryIds: string[];
}

export function isStatusFilter(value: string | null | undefined): value is StatusFilter {
  return ALL_STATUSES.some((status) => status === value);
}

export function isListScope(value: string | null | undefined): value is ListScope {
  return LIST_SCOPES.some((scope) => scope === value);
}

export function modeOfPath(pathname: string): ViewMode {
  return pathname.startsWith('/matrix') ? 'matrix' : 'list';
}

/**
 * URL → 选择。兼容旧地址：以前"收藏"是一种状态（?status=starred），现在对应范围"收藏"。
 */
export function parseSelection(pathname: string, params: URLSearchParams): Selection {
  const rawStatus = params.get('status');
  const rawScope = params.get('scope');
  const legacyStarred = rawStatus === 'starred';
  const groupId = params.get('group') || null;
  const projectId = (groupId && params.get('project')) || null;
  return {
    // 组里没有时间管理矩阵；开了任务分配的项目可以切到责任分配矩阵
    mode: groupId
      ? projectId && params.get('view') === 'raci'
        ? 'raci'
        : 'list'
      : modeOfPath(pathname),
    groupId,
    projectId,
    scope: legacyStarred ? 'starred' : isListScope(rawScope) ? rawScope : DEFAULT_LIST_SCOPE,
    status: isStatusFilter(rawStatus) ? rawStatus : DEFAULT_STATUS,
    categoryIds: params.get('cat')?.split(',').filter(Boolean) ?? [],
  };
}

/** 选择 → URL */
export function selectionHref(selection: Selection): string {
  const params = new URLSearchParams();
  if (selection.groupId && selection.mode !== 'matrix') {
    // 组里：项目、看法和状态
    params.set('group', selection.groupId);
    if (selection.projectId) params.set('project', selection.projectId);
    if (selection.mode === 'raci' && selection.projectId) params.set('view', 'raci');
    if (selection.status !== DEFAULT_STATUS) params.set('status', selection.status);
    return `/?${params.toString()}`;
  }
  if (selection.scope !== DEFAULT_LIST_SCOPE) params.set('scope', selection.scope);
  if (selection.status !== DEFAULT_STATUS) params.set('status', selection.status);
  if (selection.categoryIds.length > 0) params.set('cat', selection.categoryIds.join(','));
  const query = params.toString();
  const path = selection.mode === 'matrix' ? '/matrix' : '/';
  return query ? `${path}?${query}` : path;
}

/** 地址中的查询参数是否需要改写成当前的规范形式（旧地址兼容跳转） */
export function needsCanonicalRedirect(params: URLSearchParams): boolean {
  const status = params.get('status');
  const scope = params.get('scope');
  return (status !== null && !isStatusFilter(status)) || (scope !== null && !isListScope(scope));
}

/** 进入一个组（或组里某个项目）的任务清单，状态行保持当前选择 */
export function groupHref(
  selection: Selection,
  groupId: string,
  projectId: string | null = null,
): string {
  return selectionHref({ ...selection, mode: 'list', groupId, projectId });
}

/** 回到个人（总览）；个人没有"待确认" */
export function personal(selection: Selection): Selection {
  const mode = selection.mode === 'raci' ? 'list' : selection.mode;
  const status = selection.status === 'pending' ? DEFAULT_STATUS : selection.status;
  return { ...selection, groupId: null, projectId: null, mode, status };
}

export function toggleCategory(selection: Selection, categoryId: string): Selection {
  const categoryIds = selection.categoryIds.includes(categoryId)
    ? selection.categoryIds.filter((id) => id !== categoryId)
    : [...selection.categoryIds, categoryId];
  return { ...selection, categoryIds };
}
