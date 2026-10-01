import { describe, expect, it } from 'vitest';

import {
  groupHref,
  needsCanonicalRedirect,
  parseSelection,
  personal,
  selectionHref,
  toggleCategory,
} from './selection';

const parse = (path: string) => {
  const url = new URL(path, 'http://x');
  return parseSelection(url.pathname, url.searchParams);
};
const params = (query: string) => new URLSearchParams(query);

describe('选择：范围 + 分类 + 状态', () => {
  it('默认：清单 · 范围全部 · 所有分类 · 状态未完成', () => {
    expect(parse('/')).toEqual({
      mode: 'list',
      groupId: null,
      scope: 'all',
      status: 'todo',
      categoryIds: [],
    });
    expect(selectionHref(parse('/'))).toBe('/');
  });

  it('都保存在查询参数中，清单与矩阵共用', () => {
    const selection = parse('/matrix?scope=starred&status=completed&cat=a,b');
    expect(selection).toEqual({
      mode: 'matrix',
      groupId: null,
      scope: 'starred',
      status: 'completed',
      categoryIds: ['a', 'b'],
    });
    expect(selectionHref({ ...selection, mode: 'list' })).toBe(
      '/?scope=starred&status=completed&cat=a%2Cb',
    );
  });

  it('矩阵模式下选已完成 / 已错过不再自动切回清单', () => {
    expect(
      selectionHref({
        mode: 'matrix',
        groupId: null,
        scope: 'all',
        status: 'completed',
        categoryIds: [],
      }),
    ).toBe('/matrix?status=completed');
  });

  it('状态"全部"要写进地址（默认是未完成）', () => {
    expect(
      selectionHref({ mode: 'list', groupId: null, scope: 'all', status: 'all', categoryIds: [] }),
    ).toBe('/?status=all');
  });

  it('旧地址兼容：?status=starred → 范围收藏 + 默认状态', () => {
    expect(parse('/?status=starred')).toEqual({
      mode: 'list',
      groupId: null,
      scope: 'starred',
      status: 'todo',
      categoryIds: [],
    });
    expect(selectionHref(parse('/?status=starred&cat=a'))).toBe('/?scope=starred&cat=a');
    expect(needsCanonicalRedirect(params('status=starred'))).toBe(true);
    expect(needsCanonicalRedirect(params('status=todo&scope=starred'))).toBe(false);
  });

  it('非法值回到默认', () => {
    expect(parse('/?status=overdue&scope=x')).toMatchObject({ status: 'todo', scope: 'all' });
    expect(needsCanonicalRedirect(params('status=overdue'))).toBe(true);
  });

  it('分类开关：再点一次取消', () => {
    const base = parse('/?cat=a');
    expect(toggleCategory(base, 'b').categoryIds).toEqual(['a', 'b']);
    expect(toggleCategory(base, 'a').categoryIds).toEqual([]);
  });

  it('组：?group=id，只有清单和状态；范围、分类、矩阵在组里不起作用', () => {
    const inGroup = parse('/matrix?group=g1&status=all&scope=starred&cat=a');
    expect(inGroup).toMatchObject({ mode: 'list', groupId: 'g1', status: 'all' });
    expect(selectionHref(inGroup)).toBe('/?group=g1&status=all');
    expect(groupHref(parse('/matrix?cat=a&status=completed'), 'g2')).toBe(
      '/?group=g2&status=completed',
    );
  });

  it('在组里点分类：回到个人总览并选中这个分类', () => {
    const inGroup = parse('/?group=g1');
    expect(selectionHref({ ...personal(inGroup), categoryIds: ['a'] })).toBe('/?cat=a');
  });
});

describe('责任分配矩阵与待确认', () => {
  it('管理组：?view=raci 切到责任分配矩阵，状态行多一个待确认', () => {
    const raci = parse('/?group=g1&view=raci&status=pending');
    expect(raci).toMatchObject({ mode: 'raci', groupId: 'g1', status: 'pending' });
    expect(selectionHref(raci)).toBe('/?group=g1&view=raci&status=pending');
    expect(selectionHref({ ...raci, mode: 'list' })).toBe('/?group=g1&status=pending');
  });

  it('回到个人：不带责任分配矩阵和待确认', () => {
    const raci = parse('/?group=g1&view=raci&status=pending');
    expect(selectionHref(personal(raci))).toBe('/');
  });
});
