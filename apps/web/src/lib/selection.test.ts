import { describe, expect, it } from 'vitest';

import {
  categoryHref,
  groupHref,
  isCurrentPage,
  needsCanonicalRedirect,
  parseSelection,
  scopeHref,
  selectionHref,
  withMode,
} from './selection';

const parse = (path: string) => {
  const url = new URL(path, 'http://x');
  return parseSelection(url.pathname, url.searchParams);
};
const params = (query: string) => new URLSearchParams(query);

describe('清单的侧边栏：单选导航', () => {
  it('默认：总览 · 清单 · 状态未完成', () => {
    expect(parse('/')).toEqual({
      mode: 'list',
      listView: 'list',
      groupId: null,
      projectId: null,
      scope: 'all',
      status: 'todo',
      categoryIds: [],
    });
    expect(selectionHref(parse('/'))).toBe('/');
  });

  it('每一项是一个页面：总览、今日、收藏、分类、组、项目，一次只选一个', () => {
    expect(parse('/?scope=today')).toMatchObject({ scope: 'today', categoryIds: [] });
    expect(parse('/?scope=starred')).toMatchObject({ scope: 'starred' });
    // 分类、组优先：选了分类或组时范围不起作用
    expect(parse('/?scope=starred&cat=a')).toMatchObject({ scope: 'all', categoryIds: ['a'] });
    expect(parse('/?group=g&cat=a&scope=today')).toMatchObject({
      groupId: 'g',
      scope: 'all',
      categoryIds: [],
    });
    const s = parse('/?cat=a&status=all');
    expect(scopeHref(s, 'today')).toBe('/?scope=today&status=all');
    expect(categoryHref(s, 'b')).toBe('/?cat=b&status=all');
    expect(groupHref(s, 'g', 'p')).toBe('/?group=g&project=p&status=all');
  });

  it('当前页面（整行高亮）只有一项', () => {
    const s = parse('/?cat=a');
    expect(isCurrentPage(s, { kind: 'category', id: 'a' })).toBe(true);
    expect(isCurrentPage(s, { kind: 'scope', scope: 'all' })).toBe(false);
    expect(isCurrentPage(parse('/?scope=today'), { kind: 'scope', scope: 'today' })).toBe(true);
    const g = parse('/?group=g&project=p');
    expect(isCurrentPage(g, { kind: 'project', id: 'p' })).toBe(true);
    expect(isCurrentPage(g, { kind: 'group', id: 'g' })).toBe(false);
  });

  it('旧地址兼容：多选的分类只取第一个；?status=starred → 收藏', () => {
    expect(parse('/?cat=a,b')).toMatchObject({ categoryIds: ['a'] });
    expect(needsCanonicalRedirect(params('cat=a,b'))).toBe(true);
    expect(parse('/?status=starred')).toMatchObject({ scope: 'starred', status: 'todo' });
    expect(needsCanonicalRedirect(params('status=starred'))).toBe(true);
    expect(needsCanonicalRedirect(params('status=todo&scope=today'))).toBe(false);
  });

  it('非法值回到默认', () => {
    expect(parse('/?status=overdue&scope=x')).toMatchObject({ status: 'todo', scope: 'all' });
    expect(needsCanonicalRedirect(params('status=overdue'))).toBe(true);
  });

  it('分类开了任务关系：?cat=id&view=gantt 是甘特图', () => {
    expect(parse('/?cat=a&view=gantt')).toMatchObject({ mode: 'gantt', categoryIds: ['a'] });
    expect(parse('/?view=gantt')).toMatchObject({ mode: 'list' });
  });
});

describe('时间管理矩阵：回到进入之前的那个页面', () => {
  it('进入矩阵时地址带着当前页面，回到清单时回到那个页面（包括看法和状态）', () => {
    const gantt = parse('/?group=g&project=p&view=gantt&status=all');
    const matrix = withMode(gantt, 'matrix');
    expect(selectionHref(matrix)).toBe('/matrix?group=g&project=p&view=gantt&status=all');
    const back = parse(selectionHref(matrix));
    expect(back).toMatchObject({ mode: 'matrix', listView: 'gantt', groupId: 'g' });
    expect(selectionHref(withMode(back, back.listView))).toBe(
      '/?group=g&project=p&view=gantt&status=all',
    );
    expect(selectionHref(withMode(parse('/?scope=today'), 'matrix'))).toBe('/matrix?scope=today');
  });
});

describe('项目、责任分配矩阵与待确认', () => {
  it('项目：?group=id&project=id；进组时回到整个组', () => {
    const inProject = parse('/?group=g1&project=p1');
    expect(inProject).toMatchObject({ groupId: 'g1', projectId: 'p1', mode: 'list' });
    expect(selectionHref(inProject)).toBe('/?group=g1&project=p1');
    expect(groupHref(inProject, 'g1')).toBe('/?group=g1');
    expect(groupHref(inProject, 'g1', 'p2')).toBe('/?group=g1&project=p2');
    expect(parse('/?project=p1')).toMatchObject({ groupId: null, projectId: null });
  });

  it('项目里：?view=raci 切到责任分配矩阵，状态行多一个待确认；整个组没有责任分配矩阵', () => {
    const raci = parse('/?group=g1&project=p1&view=raci&status=pending');
    expect(raci).toMatchObject({ mode: 'raci', projectId: 'p1', status: 'pending' });
    expect(selectionHref(raci)).toBe('/?group=g1&project=p1&view=raci&status=pending');
    expect(selectionHref(withMode(raci, 'list'))).toBe('/?group=g1&project=p1&status=pending');
    expect(parse('/?group=g1&view=raci')).toMatchObject({ mode: 'list' });
  });

  it('回到个人：不带项目、责任分配矩阵和待确认（今日除外）', () => {
    const raci = parse('/?group=g1&project=p1&view=raci&status=pending');
    expect(scopeHref(raci, 'all')).toBe('/');
    expect(categoryHref(raci, 'c1')).toBe('/?cat=c1');
    expect(scopeHref(raci, 'today')).toBe('/?scope=today&status=pending');
  });
});
