import { DEFAULT_LIST_SCOPE, LIST_SCOPES, type ListScope, type StatusFilter } from '@alethego/core';

import { ALL_STATUSES, DEFAULT_STATUS } from './format';

/**
 * 当前的选择（清单的侧边栏是单选导航：每一项点下去就是一个页面）：
 * - 总览（我所有的个人任务）/ 今日 / 收藏：?scope=today、?scope=starred（总览省略）
 * - 某个个人分类：?cat=id
 * - 某个组（组里我能看到的所有项目的任务）：?group=id；组里的某个项目：?group=id&project=id
 * - 状态（清单页面内、添加栏下面一行，单选）：?status=…（默认"未完成"时省略）
 * - 看法：清单 / 责任分配矩阵（?view=raci）/ 甘特图（?view=gantt）
 * 时间管理矩阵是 /matrix，用自己的筛选栏（勾选存在账号上），不看这些；但地址里保留进入矩阵之前
 * 所在的页面（同样的查询参数），从矩阵回到清单时回到那个页面。
 */

/**
 * 看法：清单 / 时间管理矩阵 / 责任分配矩阵（开了任务分配的项目，?view=raci）/
 * 甘特图（开了任务关系的项目，或者开了任务关系的个人分类，?view=gantt）
 */
export type ViewMode = 'list' | 'matrix' | 'raci' | 'gantt';

/** 清单这一侧的看法（矩阵模式下记着进入矩阵之前的那一个） */
export type ListView = Exclude<ViewMode, 'matrix'>;

export interface Selection {
  mode: ViewMode;
  /** 清单这一侧的看法：不在矩阵里时等于 mode */
  listView: ListView;
  /** 当前所在的组；null = 个人 */
  groupId: string | null;
  /** 组里选中的项目；null = 整个组 */
  projectId: string | null;
  /** 总览 / 今日 / 收藏；选了分类、组、项目时为"总览"（不起作用） */
  scope: ListScope;
  status: StatusFilter;
  /** 选中的个人分类：最多一个 */
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
 * URL → 选择。兼容旧地址：以前"收藏"是一种状态（?status=starred）；以前分类可以多选（?cat=a,b），只取第一个。
 */
export function parseSelection(pathname: string, params: URLSearchParams): Selection {
  const rawStatus = params.get('status');
  const rawScope = params.get('scope');
  const legacyStarred = rawStatus === 'starred';
  const groupId = params.get('group') || null;
  const projectId = (groupId && params.get('project')) || null;
  const view = params.get('view');
  const category = groupId ? null : (params.get('cat')?.split(',').find(Boolean) ?? null);
  // 项目页面可以切到责任分配矩阵、甘特图；分类页面可以切到甘特图
  const listView: ListView =
    (projectId && (view === 'raci' || view === 'gantt')) || (category && view === 'gantt')
      ? (view as ListView)
      : 'list';
  const scope: ListScope =
    groupId || category
      ? DEFAULT_LIST_SCOPE
      : legacyStarred
        ? 'starred'
        : isListScope(rawScope)
          ? rawScope
          : DEFAULT_LIST_SCOPE;
  return {
    mode: modeOfPath(pathname) === 'matrix' ? 'matrix' : listView,
    listView,
    groupId,
    projectId,
    scope,
    status: isStatusFilter(rawStatus) ? rawStatus : DEFAULT_STATUS,
    categoryIds: category ? [category] : [],
  };
}

/** 选择 → URL（矩阵模式下保留清单这一侧的页面，回来时用） */
export function selectionHref(selection: Selection): string {
  const params = new URLSearchParams();
  const view = selection.mode === 'matrix' ? selection.listView : selection.mode;
  if (selection.groupId) {
    params.set('group', selection.groupId);
    if (selection.projectId) params.set('project', selection.projectId);
    if ((view === 'raci' || view === 'gantt') && selection.projectId) params.set('view', view);
  } else if (selection.categoryIds.length > 0) {
    params.set('cat', selection.categoryIds[0]!);
    if (view === 'gantt') params.set('view', 'gantt');
  } else if (selection.scope !== DEFAULT_LIST_SCOPE) {
    params.set('scope', selection.scope);
  }
  if (selection.status !== DEFAULT_STATUS) params.set('status', selection.status);
  const query = params.toString();
  const path = selection.mode === 'matrix' ? '/matrix' : '/';
  return query ? `${path}?${query}` : path;
}

/** 换一种看法（清单 / 责任分配矩阵 / 甘特图 / 时间管理矩阵） */
export function withMode(selection: Selection, mode: ViewMode): Selection {
  return mode === 'matrix' ? { ...selection, mode } : { ...selection, mode, listView: mode };
}

/** 地址中的查询参数是否需要改写成当前的规范形式（旧地址兼容跳转） */
export function needsCanonicalRedirect(params: URLSearchParams): boolean {
  const status = params.get('status');
  const scope = params.get('scope');
  return (
    (status !== null && !isStatusFilter(status)) ||
    (scope !== null && !isListScope(scope)) ||
    (params.get('cat')?.includes(',') ?? false)
  );
}

/** 个人的页面没有"待确认"（今日除外：今日里有开了任务分配的项目的任务） */
const personalStatus = (status: StatusFilter) => (status === 'pending' ? DEFAULT_STATUS : status);

/** 侧边栏上一项对应的页面（清单），状态行保持当前选择 */
export function scopeHref(selection: Selection, scope: ListScope): string {
  return selectionHref({
    mode: 'list',
    listView: 'list',
    groupId: null,
    projectId: null,
    scope,
    categoryIds: [],
    status: scope === 'today' ? selection.status : personalStatus(selection.status),
  });
}

export function categoryHref(selection: Selection, categoryId: string): string {
  return selectionHref({
    mode: 'list',
    listView: 'list',
    groupId: null,
    projectId: null,
    scope: DEFAULT_LIST_SCOPE,
    categoryIds: [categoryId],
    status: personalStatus(selection.status),
  });
}

/** 进入一个组（或组里某个项目）的任务清单，状态行保持当前选择 */
export function groupHref(
  selection: Selection,
  groupId: string,
  projectId: string | null = null,
): string {
  return selectionHref({
    mode: 'list',
    listView: 'list',
    groupId,
    projectId,
    scope: DEFAULT_LIST_SCOPE,
    categoryIds: [],
    status: selection.status,
  });
}

/** 这一项是不是当前页面（侧边栏的整行高亮） */
export function isCurrentPage(
  selection: Selection,
  item:
    | { kind: 'scope'; scope: ListScope }
    | { kind: 'category'; id: string }
    | { kind: 'group'; id: string }
    | { kind: 'project'; id: string },
): boolean {
  switch (item.kind) {
    case 'scope':
      return (
        !selection.groupId && selection.categoryIds.length === 0 && selection.scope === item.scope
      );
    case 'category':
      return !selection.groupId && selection.categoryIds[0] === item.id;
    case 'group':
      return selection.groupId === item.id && !selection.projectId;
    case 'project':
      return selection.projectId === item.id;
  }
}
