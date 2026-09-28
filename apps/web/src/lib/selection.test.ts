import { describe, expect, it } from 'vitest';

import { parseSelection, selectionHref, toggleCategory } from './selection';

const parse = (path: string) => {
  const url = new URL(path, 'http://x');
  return parseSelection(url.pathname, url.searchParams);
};

describe('左侧菜单的选择', () => {
  it('默认：清单 · 全部 · 所有分类', () => {
    expect(parse('/')).toEqual({ mode: 'list', status: 'all', categoryIds: [] });
    expect(selectionHref(parse('/'))).toBe('/');
  });

  it('状态与分类都保存在查询参数中，清单与矩阵共用', () => {
    const selection = parse('/matrix?status=starred&cat=a,b');
    expect(selection).toEqual({ mode: 'matrix', status: 'starred', categoryIds: ['a', 'b'] });
    expect(selectionHref({ ...selection, mode: 'list' })).toBe('/?status=starred&cat=a%2Cb');
  });

  it('非法状态回到默认', () => {
    expect(parse('/?status=overdue').status).toBe('all');
  });

  it('矩阵模式下选已完成 / 已错过时切回清单', () => {
    expect(selectionHref({ mode: 'matrix', status: 'completed', categoryIds: [] })).toBe(
      '/?status=completed',
    );
    expect(selectionHref({ mode: 'matrix', status: 'todo', categoryIds: [] })).toBe(
      '/matrix?status=todo',
    );
  });

  it('分类开关：再点一次取消', () => {
    const base = parse('/?cat=a');
    expect(toggleCategory(base, 'b').categoryIds).toEqual(['a', 'b']);
    expect(toggleCategory(base, 'a').categoryIds).toEqual([]);
  });
});
