import type { Task } from '../domain/task';

/**
 * 时间管理矩阵的筛选栏（进入矩阵后替换左边的侧边栏）：
 * - "个人"分区，下面是个人分类；"组"分区，下面是各个组，组下面是项目
 * - 每一行一个勾选框，可以多选；矩阵显示所有勾选内容的并集
 *   - 勾"个人" = 全部个人任务（包括没有分类的）；只勾部分分类 = 只有属于这些分类的个人任务
 *   - 勾组 = 勾它下面的全部项目（以后新建的项目也算）；只勾了部分项目时，组显示部分选中
 *   - 选中的项目里只显示"和我有关的组任务"
 * - 第一次进入时只勾"个人"；之后记住上一次的勾选（存在账号上）
 */
export interface MatrixFilter {
  /** 全部个人任务 */
  personal: boolean;
  /** 单独勾选的个人分类（personal 为 true 时不用） */
  categories: string[];
  /** 整组勾选的组 */
  groups: string[];
  /** 单独勾选的项目（所属的组整组勾选时不用） */
  projects: string[];
}

export const DEFAULT_MATRIX_FILTER: MatrixFilter = {
  personal: true,
  categories: [],
  groups: [],
  projects: [],
};

export type CheckState = 'checked' | 'partial' | 'unchecked';

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string'))] : [];

/** 账号上存的值 → 筛选；没存过（null）或格式不对时用默认值 */
export function parseMatrixFilter(value: unknown): MatrixFilter {
  if (!value || typeof value !== 'object') return DEFAULT_MATRIX_FILTER;
  const raw = value as Record<string, unknown>;
  return {
    personal: raw.personal === true,
    categories: strings(raw.categories),
    groups: strings(raw.groups),
    projects: strings(raw.projects),
  };
}

/** 树的结构：个人分类；每个组和它下面的项目 */
export interface MatrixFilterTree {
  categoryIds: readonly string[];
  groups: readonly { id: string; projectIds: readonly string[] }[];
}

function stateOf(all: boolean, some: readonly string[], children: readonly string[]): CheckState {
  if (all) return 'checked';
  const picked = children.filter((id) => some.includes(id)).length;
  if (picked === 0) return 'unchecked';
  return picked === children.length ? 'checked' : 'partial';
}

export function personalState(filter: MatrixFilter, tree: MatrixFilterTree): CheckState {
  return stateOf(filter.personal, filter.categories, tree.categoryIds);
}

export function categoryChecked(filter: MatrixFilter, categoryId: string): boolean {
  return filter.personal || filter.categories.includes(categoryId);
}

export function groupState(
  filter: MatrixFilter,
  group: MatrixFilterTree['groups'][number],
): CheckState {
  return stateOf(filter.groups.includes(group.id), filter.projects, group.projectIds);
}

export function projectChecked(filter: MatrixFilter, groupId: string, projectId: string): boolean {
  return filter.groups.includes(groupId) || filter.projects.includes(projectId);
}

/** 勾 / 取消"个人"：勾上 = 全部个人任务；部分选中时再点 = 全部勾上 */
export function togglePersonal(filter: MatrixFilter, tree: MatrixFilterTree): MatrixFilter {
  const checked = personalState(filter, tree) === 'checked';
  return { ...filter, personal: !checked, categories: [] };
}

/** 勾 / 取消一个分类；分类全勾上了就等于勾"个人" */
export function toggleCategory(
  filter: MatrixFilter,
  tree: MatrixFilterTree,
  categoryId: string,
): MatrixFilter {
  const current = filter.personal ? [...tree.categoryIds] : filter.categories;
  const next = current.includes(categoryId)
    ? current.filter((id) => id !== categoryId)
    : [...current, categoryId];
  const all = tree.categoryIds.length > 0 && tree.categoryIds.every((id) => next.includes(id));
  return { ...filter, personal: all, categories: all ? [] : next };
}

/** 勾 / 取消一个组：勾上 = 整组（它下面的全部项目） */
export function toggleGroup(
  filter: MatrixFilter,
  group: MatrixFilterTree['groups'][number],
): MatrixFilter {
  const checked = groupState(filter, group) === 'checked';
  const projects = filter.projects.filter((id) => !group.projectIds.includes(id));
  return {
    ...filter,
    groups: checked ? filter.groups.filter((id) => id !== group.id) : [...filter.groups, group.id],
    projects,
  };
}

/** 勾 / 取消组里的一个项目；组里的项目全勾上了就等于整组勾选 */
export function toggleProject(
  filter: MatrixFilter,
  group: MatrixFilterTree['groups'][number],
  projectId: string,
): MatrixFilter {
  const whole = filter.groups.includes(group.id);
  const current = whole
    ? [...group.projectIds]
    : filter.projects.filter((id) => group.projectIds.includes(id));
  const next = current.includes(projectId)
    ? current.filter((id) => id !== projectId)
    : [...current, projectId];
  const all = group.projectIds.length > 0 && group.projectIds.every((id) => next.includes(id));
  const others = filter.projects.filter((id) => !group.projectIds.includes(id));
  const groups = filter.groups.filter((id) => id !== group.id);
  return {
    ...filter,
    groups: all ? [...groups, group.id] : groups,
    projects: all ? others : [...others, ...next],
  };
}

/** 一条任务在不在矩阵的勾选范围里（是否画出来再由矩阵自己的规则决定） */
export function matrixFilterIncludes(
  task: Pick<Task, 'id' | 'groupId' | 'projectId'>,
  filter: MatrixFilter,
  context: {
    categoryIdsOf: (taskId: string) => readonly string[];
    isRelatedGroupTask: (task: Pick<Task, 'id' | 'groupId' | 'projectId'>) => boolean;
  },
): boolean {
  if (task.groupId === null) {
    if (filter.personal) return true;
    const categories = context.categoryIdsOf(task.id);
    return filter.categories.some((id) => categories.includes(id));
  }
  if (!task.projectId) return false;
  const selected = filter.groups.includes(task.groupId) || filter.projects.includes(task.projectId);
  return selected && context.isRelatedGroupTask(task);
}
