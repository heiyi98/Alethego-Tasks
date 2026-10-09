import { expect, test, type Page } from '@playwright/test';

import { accessTokenFor } from './auth';
import {
  groupTask,
  groupWith,
  openAs,
  projectIn,
  projectLink,
  select,
  user,
  userId,
} from './group-helpers';
import {
  IMPORTANCE_NAMES,
  createCategory,
  editPanel,
  filterBar,
  filterCheck,
  importanceButton,
  localDate,
  quickAdd,
  quickAddBar,
  runId,
  selectCategory,
  selectStatus,
  sidebar,
  switchMode,
  taskItem,
} from './helpers';

// 多个账号各用自己的浏览器上下文：从"没登录"开始
test.use({ storageState: { cookies: [], origins: [] } });

const dot = (page: Page, title: string) => page.locator(`.matrix-node[aria-label^="${title}，"]`);
const endOf = (date: string) => `${date}T23:59:59.999+08:00`;
const scopeLink = (page: Page, name: string) =>
  sidebar(page)
    .getByRole('region', { name: '范围' })
    .getByRole('link', { name: new RegExp(`^${name}`) });
const heading = (page: Page) => page.locator('h1.title-bar');

test('重要性四档：选项由强到弱、默认随意、显示名字；矩阵纵轴 0–3、中线在应该和可以之间；没截止时间的随意任务不进矩阵', async ({
  browser,
}) => {
  const id = runId();
  const me = await user('imp', `${id}我`);
  const page = await openAs(browser, me);
  const bar = quickAddBar(page);
  await page.getByLabel('快速添加任务').fill(`${id} 草稿`);
  await expect(bar.getByRole('group', { name: '重要性' }).getByRole('button')).toHaveText([
    '必须',
    '应该',
    '可以',
    '随意',
  ]);
  await expect(importanceButton(bar, 0)).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('快速添加任务').fill('');

  await quickAdd(page, `${id} 必须`, { importance: 3, deadline: localDate(1) });
  await quickAdd(page, `${id} 应该`, { importance: 2, deadline: localDate(1) });
  await quickAdd(page, `${id} 可以`, { importance: 1, deadline: localDate(1) });
  await quickAdd(page, `${id} 随意有截止`, { deadline: localDate(1) });
  await quickAdd(page, `${id} 随意无截止`);
  await quickAdd(page, `${id} 可以无截止`, { importance: 1 });
  await expect(taskItem(page, `${id} 必须`).locator('.task-importance')).toHaveText('必须');
  await expect(taskItem(page, `${id} 随意无截止`).locator('.task-importance')).toHaveCount(0);
  const rows = await select<{ title: string; importance_level: number }>(
    me,
    `tasks?select=title,importance_level&title=like.${encodeURIComponent(`${id}*`)}`,
  );
  expect(
    Object.fromEntries(rows.map((r) => [r.title.replace(`${id} `, ''), r.importance_level])),
  ).toEqual({ 必须: 3, 应该: 2, 可以: 1, 随意有截止: 0, 随意无截止: 0, 可以无截止: 1 });

  await switchMode(page, 'matrix');
  await expect(page.getByTestId('matrix-y-tick')).toHaveText(['0', '1', '2', '3']);
  for (const [name, row] of [
    ['必须', '3'],
    ['应该', '2'],
    ['可以', '1'],
    ['随意有截止', '0'],
  ] as const) {
    await expect(dot(page, `${id} ${name}`)).toHaveAttribute('data-row', row);
  }
  // 中线在"应该"和"可以"之间：应该算重要，可以算不重要
  const quadrant = (label: string) => page.getByRole('region', { name: label });
  await expect(quadrant('重要且紧急')).toContainText(`${id} 应该`);
  await expect(quadrant('紧急不重要')).toContainText(`${id} 可以`);
  // 没截止时间：随意的不进矩阵，可以的钉在最左边
  await expect(dot(page, `${id} 随意无截止`)).toHaveCount(0);
  await expect(dot(page, `${id} 可以无截止`)).toHaveAttribute('data-column', 'no-deadline');
  // 图里纵轴只写数字，不写档位的名字
  const texts = await page.locator('svg.matrix text').allTextContents();
  for (const name of IMPORTANCE_NAMES) expect(texts.some((t) => t === name)).toBe(false);
  await page.context().close();
});

test('清单单选导航：每一项是一个页面，标题是那一项的名字，一次只高亮一项；没有分类胶囊', async ({
  browser,
}) => {
  const id = runId();
  const me = await user('nav', `${id}我`);
  const page = await openAs(browser, me);
  await createCategory(page, `${id}工作`);
  await createCategory(page, `${id}家里`);
  await quickAdd(page, `${id} 工作的事`);
  await selectCategory(page, `${id}工作`);
  await quickAdd(page, `${id} 新工作`);
  // 在分类里新建的任务带上这个分类；分类页只列这个分类的任务
  await expect(taskItem(page, `${id} 工作的事`)).toHaveCount(0);
  await selectCategory(page, `${id}家里`);
  await expect(taskItem(page, `${id} 新工作`)).toHaveCount(0);
  await expect(sidebar(page).locator('[aria-current="page"]')).toHaveCount(1);
  await expect(page.getByTestId('title-capsule')).toHaveCount(0);
  for (const name of ['总览', '今日', '收藏']) {
    await scopeLink(page, name).click();
    await expect(heading(page)).toHaveText(name);
    await expect(scopeLink(page, name)).toHaveAttribute('aria-current', 'page');
    await expect(sidebar(page).locator('[aria-current="page"]')).toHaveCount(1);
  }
  // "个人"和"组"两个分区都可以收起
  await sidebar(page).getByRole('button', { name: '个人' }).click();
  await expect(sidebar(page).getByRole('link', { name: new RegExp(`^${id}工作`) })).toHaveCount(0);
  await sidebar(page).getByRole('button', { name: '个人' }).click();
  await expect(sidebar(page).getByRole('link', { name: new RegExp(`^${id}工作`) })).toBeVisible();
  await page.context().close();
});

test('组任务的重要性（管理员设定、全组共用、快捷添加栏里也有）；今日 = 个人任务 + 和我有关的组任务，今天截止和逾期不满三天', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const id = runId();
  const L = await user('tl', `${id}组长`);
  const M = await user('tm', `${id}组员`);
  const groupId = await groupWith(L, [M], `${id}组`, 'management');
  const assign = await projectIn(L, groupId, `${id}分配`, ['assignment'], [M]);
  const plain = await projectIn(L, groupId, `${id}普通`, [], [M]);
  const [lId, mId] = [await userId(L), await userId(M)];
  const raci = (r: string) => [
    { role: 'R' as const, userId: r },
    { role: 'A' as const, userId: lId },
  ];
  await groupTask(L, assign, `${id} 我执行`, raci(mId), { deadline_at: endOf(localDate(0)) });
  await groupTask(L, assign, `${id} 别人执行`, raci(lId), { deadline_at: endOf(localDate(0)) });
  await groupTask(L, plain, `${id} 普通项目`, [], { deadline_at: endOf(localDate(-2)) });
  await groupTask(L, plain, `${id} 普通明天`, [], { deadline_at: endOf(localDate(1)) });

  // 管理员（组长）在快捷添加栏和详情里都能设重要性
  const pl = await openAs(browser, L);
  await projectLink(pl, `${id}普通`).click();
  await pl.getByLabel('快速添加任务').fill(`${id} 组里新建`);
  await importanceButton(quickAddBar(pl), 3).click();
  await quickAddBar(pl).getByRole('button', { name: '创建', exact: true }).click();
  await expect(taskItem(pl, `${id} 组里新建`).locator('.task-importance')).toHaveText('必须');
  await projectLink(pl, `${id}分配`).click();
  await pl.getByLabel('快速添加任务').fill(`${id} 分配里新建`);
  await expect(importanceButton(quickAddBar(pl), 2)).toBeVisible();
  await pl.getByLabel('快速添加任务').fill('');
  await taskItem(pl, `${id} 我执行`).locator('.task-main').first().click();
  await importanceButton(editPanel(pl), 2).click();
  await editPanel(pl).getByRole('button', { name: '完成编辑' }).first().click();
  await expect(editPanel(pl)).toHaveCount(0);
  const [mine] = await select<{ importance_level: number }>(
    M,
    `tasks?select=importance_level&title=eq.${encodeURIComponent(`${id} 我执行`)}`,
  );
  expect(mine!.importance_level).toBe(2);
  // 组员不能改重要性（数据库也拦住）
  const denied = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/tasks?title=eq.${encodeURIComponent(`${id} 我执行`)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${await accessTokenFor(M)}`,
        'Content-Profile': 'taskapp',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ importance_level: 3 }),
    },
  );
  expect(denied.status).toBe(403);

  // 组员的今日
  const pm = await openAs(browser, M);
  await quickAdd(pm, `${id} 个人今天`, { deadline: localDate(0) });
  await quickAdd(pm, `${id} 个人逾期两天`, { deadline: localDate(-2), expectVisible: false });
  await quickAdd(pm, `${id} 个人逾期三天`, { deadline: localDate(-3), expectVisible: false });
  await scopeLink(pm, '今日').click();
  await expect(heading(pm)).toHaveText('今日');
  const titles = () =>
    pm
      .locator('.task-list .task-title')
      .allTextContents()
      .then((all) => all.filter((t) => t.startsWith(id)).sort());
  // 状态行默认"未完成"：今天截止、还没到时间的
  await expect(
    pm.getByRole('group', { name: '状态' }).getByRole('button', { name: '未完成' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(titles).toEqual([`${id} 个人今天`, `${id} 我执行`].sort());
  // 全部：再加上逾期不满三天的；逾期满三天、明天截止的都不在
  await selectStatus(pm, '全部');
  await expect
    .poll(titles)
    .toEqual([`${id} 个人今天`, `${id} 个人逾期两天`, `${id} 我执行`, `${id} 普通项目`].sort());
  await selectStatus(pm, '已错过');
  await expect.poll(titles).toEqual([`${id} 个人逾期两天`, `${id} 普通项目`].sort());
  await selectStatus(pm, '全部');
  // 组员在组任务的详情里只能看重要性
  await taskItem(pm, `${id} 我执行`).locator('.task-main').first().click();
  await expect(importanceButton(editPanel(pm), 2)).toHaveAttribute('aria-pressed', 'true');
  await expect(importanceButton(editPanel(pm), 3)).toBeDisabled();
  await pm.keyboard.press('Escape');
  // 只有清单这一种看法；里面有开了任务分配的项目的任务，状态行有"待确认"
  await expect(pm.getByRole('group', { name: '看法' })).toHaveCount(0);
  await expect(pm.getByRole('group', { name: '状态' }).getByRole('button')).toHaveText([
    '全部',
    '未完成',
    '待确认',
    '已完成',
    '已错过',
  ]);
  // 在今日里新建的任务截止日期默认是今天
  await quickAdd(pm, `${id} 今日里新建`);
  const [created] = await select<{ deadline_at: string }>(
    M,
    `tasks?select=deadline_at&title=eq.${encodeURIComponent(`${id} 今日里新建`)}`,
  );
  expect(new Date(created!.deadline_at).toISOString()).toBe(
    new Date(endOf(localDate(0))).toISOString(),
  );
  // 总览里没有组任务
  await scopeLink(pm, '总览').click();
  await expect(taskItem(pm, `${id} 我执行`)).toHaveCount(0);
  await pl.context().close();
  await pm.context().close();
});

test('矩阵筛选栏：第一次只勾个人；组的勾选框部分选中；个人只勾部分分类；只显示和我有关的组任务；勾选存在账号上（换设备一样）；回到进入前的页面', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const id = runId();
  const L = await user('ml', `${id}组长`);
  const M = await user('mm', `${id}组员`);
  const groupId = await groupWith(L, [M], `${id}组`, 'management');
  const assign = await projectIn(L, groupId, `${id}分配`, ['assignment'], [M]);
  const plain = await projectIn(L, groupId, `${id}普通`, [], [M]);
  const [lId, mId] = [await userId(L), await userId(M)];
  const raci = (r: string) => [
    { role: 'R' as const, userId: r },
    { role: 'A' as const, userId: lId },
  ];
  const tomorrow = endOf(localDate(1));
  await groupTask(L, assign, `${id} 我执行`, raci(mId), { deadline_at: tomorrow });
  await groupTask(L, assign, `${id} 别人执行`, raci(lId), { deadline_at: tomorrow });
  await groupTask(L, plain, `${id} 普通项目`, [], { deadline_at: tomorrow });

  const pm = await openAs(browser, M);
  await createCategory(pm, `${id}甲`);
  await createCategory(pm, `${id}乙`);
  await selectCategory(pm, `${id}甲`);
  await quickAdd(pm, `${id} 甲的事`, { deadline: localDate(1) });
  await selectCategory(pm, `${id}乙`);
  await quickAdd(pm, `${id} 乙的事`, { deadline: localDate(1) });
  await sidebar(pm)
    .getByRole('region', { name: '范围' })
    .getByRole('link', { name: /^总览/ })
    .click();
  await quickAdd(pm, `${id} 没分类`, { deadline: localDate(1) });

  // 从项目页面进入矩阵
  await projectLink(pm, `${id}普通`).click();
  await switchMode(pm, 'matrix');
  await expect(sidebar(pm)).toHaveCount(0);
  await expect(filterBar(pm).getByRole('link', { name: /总览|今日|收藏/ })).toHaveCount(0);
  await expect(filterCheck(pm, '个人')).toBeChecked();
  await expect(filterCheck(pm, `${id}组`)).not.toBeChecked();
  await expect(dot(pm, `${id} 没分类`)).toHaveCount(1);
  await expect(dot(pm, `${id} 我执行`)).toHaveCount(0);

  // 勾一个项目：组部分选中；只显示和我有关的组任务
  await filterCheck(pm, `${id}分配`).check();
  await expect(filterCheck(pm, `${id}组`)).toHaveAttribute('aria-checked', 'mixed');
  await expect(dot(pm, `${id} 我执行`)).toHaveCount(1);
  await expect(dot(pm, `${id} 别人执行`)).toHaveCount(0);
  await expect(dot(pm, `${id} 普通项目`)).toHaveCount(0);
  // 勾组 = 勾全部项目
  await filterCheck(pm, `${id}组`).click();
  await expect(filterCheck(pm, `${id}组`)).toBeChecked();
  await expect(filterCheck(pm, `${id}普通`)).toBeChecked();
  await expect(dot(pm, `${id} 普通项目`)).toHaveCount(1);
  // 个人只勾部分分类：个人部分选中，只有这些分类的个人任务
  await filterCheck(pm, `${id}乙`).uncheck();
  await expect(filterCheck(pm, '个人')).toHaveAttribute('aria-checked', 'mixed');
  await expect(dot(pm, `${id} 甲的事`)).toHaveCount(1);
  await expect(dot(pm, `${id} 乙的事`)).toHaveCount(0);
  await expect(dot(pm, `${id} 没分类`)).toHaveCount(0);

  // 勾选存在账号上
  await expect
    .poll(
      async () =>
        (await select<{ matrix_filter: unknown }>(M, 'users?select=matrix_filter'))[0]!
          .matrix_filter,
    )
    .toMatchObject({ personal: false, groups: [groupId] });
  // 回到清单：回到进入矩阵之前的那个项目页面
  await switchMode(pm, 'list');
  await expect(heading(pm)).toHaveText(`${id}普通`);

  // 换一台设备（新的浏览器上下文），从另一个页面进入：还是上一次的勾选
  const other = await openAs(browser, M);
  await switchMode(other, 'matrix');
  await expect(filterCheck(other, `${id}组`)).toBeChecked();
  await expect(filterCheck(other, '个人')).toHaveAttribute('aria-checked', 'mixed');
  await expect(dot(other, `${id} 我执行`)).toHaveCount(1);
  await expect(dot(other, `${id} 乙的事`)).toHaveCount(0);
  await pm.context().close();
  await other.context().close();
});
