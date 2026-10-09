import { expect, test, type Page } from '@playwright/test';

import {
  bell,
  groupLink,
  groupTask,
  groupWith,
  notificationList,
  openAs,
  projectIn,
  projectLink,
  rpc,
  select,
  sidebar,
  user,
  userId,
  type GroupUser,
} from './group-helpers';
import {
  categoryItem,
  editPanel,
  localDate,
  runId,
  selectStatus,
  taskItem,
  waitSaved,
} from './helpers';

// 多个账号各用自己的浏览器上下文：从"没登录"开始
test.use({ storageState: { cookies: [], origins: [] } });

const ZONE = 'Asia/Shanghai';
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** "YYYY-MM-DD" → "10月12日 周一"（和页面上的写法一样） */
function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${m}月${d}日 周${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}`;
}

/** 准备：设定一条任务的开始和结束（按这个账号的身份） */
async function schedule(
  u: GroupUser,
  taskId: string,
  input: {
    start?: string | null;
    startRelations?: { predecessor_id: string; anchor: 'start' | 'end'; offset_days?: number }[];
    after?: number | null;
    endRelations?: { predecessor_id: string; anchor: 'start' | 'end'; offset_days?: number }[];
  },
) {
  return rpc<{ deadline_at: string | null; start_on: string | null }>(u, 'set_task_schedule', {
    p_task_id: taskId,
    p_start_on: input.start ?? null,
    p_start_relations: input.startRelations ?? [],
    p_end_after_days: input.after ?? null,
    p_end_relations: input.endRelations ?? [],
    p_date_zone: ZONE,
  });
}

/** 在清单里展开一条任务 */
async function open(page: Page, title: string) {
  await taskItem(page, title).locator('.task-title').click();
  await expect(editPanel(page)).toBeVisible();
  return editPanel(page);
}

const startRow = (page: Page) => editPanel(page).getByRole('group', { name: '开始', exact: true });
const endRow = (page: Page) => editPanel(page).getByRole('group', { name: '结束', exact: true });

test('开始和结束：固定日期、开始后 N 天、关系（多个取最晚、偏移）；结束写进截止时间；里程碑', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const id = runId();
  const L = await user('sl', `${id}组长`);
  const groupId = await groupWith(L, [], `${id}组`);
  const projectId = await projectIn(L, groupId, `${id}项目`, ['relations']);
  await groupTask(L, projectId, `${id} 甲`);
  await groupTask(L, projectId, `${id} 乙`, [], { deadline_at: null });
  const page = await openAs(browser, L);
  await projectLink(page, `${id}项目`).click();

  // 甲：开始是固定日期，结束是开始后 3 天
  let panel = await open(page, `${id} 甲`);
  // 截止日期挪到了"结束"那一行
  await expect(panel.locator('.quick-options').getByLabel('截止日期')).toHaveCount(0);
  await startRow(page).getByLabel('开始日期', { exact: true }).fill(localDate(2));
  await endRow(page).getByRole('radio', { name: '开始后' }).click();
  await endRow(page).getByLabel('开始后的天数').fill('3');
  await expect(endRow(page).getByLabel('算出的结束')).toHaveText(dayLabel(localDate(5)));
  await waitSaved(page);
  await expect(taskItem(page, `${id} 甲`).locator('.task-deadline')).toContainText(
    dayLabel(localDate(5)).split(' ')[0]!,
  );
  const [a] = await select<{ id: string; start_on: string; end_after_days: number }>(
    L,
    `tasks?select=id,start_on,end_after_days&title=eq.${id} 甲`,
  );
  expect(a).toMatchObject({ start_on: localDate(2), end_after_days: 3 });

  // 乙：开始于甲的结束后 1 天、也于甲的开始（取最晚）；结束是开始后 0 天 → 里程碑
  panel = await open(page, `${id} 乙`);
  await startRow(page).getByRole('radio', { name: '关系' }).click();
  const starts = panel.getByRole('list', { name: '开始的关系' });
  await starts.getByLabel('关系对象').selectOption({ label: `${id} 甲` });
  await starts.getByLabel('偏移', { exact: true }).click();
  await starts.getByRole('button', { name: '后一天' }).click();
  await expect(starts.getByLabel('偏移', { exact: true })).toHaveText('后 1 天');
  await starts.getByRole('button', { name: '添加开始的关系' }).click();
  await starts
    .getByLabel('关系对象')
    .nth(1)
    .selectOption({ label: `${id} 甲` });
  await starts.getByLabel('开始还是结束').nth(1).selectOption('start');
  await expect(starts.getByLabel('偏移', { exact: true }).nth(1)).toHaveText('当天');
  await expect(startRow(page).getByLabel('算出的开始')).toHaveText(dayLabel(localDate(6)));
  await endRow(page).getByRole('radio', { name: '开始后' }).click();
  await endRow(page).getByLabel('开始后的天数').fill('0');
  await waitSaved(page);
  // 偏移也可以直接输入，"前 N 天"（保存后同一条任务又展开着）
  await expect(starts.getByLabel('关系对象')).toHaveCount(2);
  await starts.getByLabel('偏移', { exact: true }).first().click();
  await starts.getByLabel('偏移的天数').first().fill('-2');
  await expect(starts.getByLabel('偏移', { exact: true }).first()).toHaveText('前 2 天');
  // 前 2 天 → 甲的结束 −2 早于甲的开始 → 取最晚的那个（甲的开始）
  await expect(startRow(page).getByLabel('算出的开始')).toHaveText(dayLabel(localDate(3)));
  await waitSaved(page);
  const [b] = await select<{ start_on: string; deadline_at: string }>(
    L,
    `tasks?select=start_on,deadline_at&title=eq.${id} 乙`,
  );
  expect(b!.start_on).toBe(localDate(3));
  expect(new Date(b!.deadline_at).toISOString()).toBe(
    new Date(`${localDate(3)}T23:59:59.999+08:00`).toISOString(),
  );

  // 甘特图：乙（开始和结束同一天）画成里程碑
  await page.getByRole('link', { name: '切换到甘特图' }).click();
  await expect(page).toHaveURL(/view=gantt/);
  const milestone = page.locator('.gantt-row').filter({ hasText: `${id} 乙` });
  await expect(milestone.locator('[data-milestone]')).toHaveCount(1);
  await expect(
    page
      .locator('.gantt-row')
      .filter({ hasText: `${id} 甲` })
      .locator('[data-milestone]'),
  ).toHaveCount(0);
  await page.context().close();
});

test('选关系对象：先选项目或分类再选任务；跨项目、跨分类可以，不开任务关系的、组外的、循环任务不在其中', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const id = runId();
  const L = await user('ol', `${id}组长`);
  const groupId = await groupWith(L, [], `${id}组`);
  const p1 = await projectIn(L, groupId, `${id}一`, ['relations']);
  const p2 = await projectIn(L, groupId, `${id}二`, ['relations']);
  const p3 = await projectIn(L, groupId, `${id}三`, []);
  await groupTask(L, p1, `${id} 本项目`);
  await groupTask(L, p2, `${id} 别的项目`, [], {
    deadline_at: `${localDate(4)}T23:59:59.999+08:00`,
  });
  await groupTask(L, p3, `${id} 没开的项目`);
  await groupTask(L, p2, `${id} 循环`, [], {
    recurrence_rule: 'FREQ=DAILY',
    recurrence_dtstart: `${localDate(0)}T09:00:00+08:00`,
  });
  const page = await openAs(browser, L);
  await projectLink(page, `${id}一`).click();
  const panel = await open(page, `${id} 本项目`);
  await endRow(page).getByRole('radio', { name: '关系' }).click();
  const ends = panel.getByRole('list', { name: '结束的关系' });
  // 默认是当前所在的项目；只列出开了任务关系的项目
  const scope = ends.getByLabel('项目或分类');
  await expect(scope).toHaveValue(p1);
  await expect(scope.locator('option')).toHaveText([`${id}一`, `${id}二`]);
  await scope.selectOption({ label: `${id}二` });
  // 循环任务不能被选为关系对象
  await expect(ends.getByLabel('关系对象').locator('option')).toHaveText(['—', `${id} 别的项目`]);
  await ends.getByLabel('关系对象').selectOption({ label: `${id} 别的项目` });
  await expect(endRow(page).getByLabel('算出的结束')).toHaveText(dayLabel(localDate(4)));
  await waitSaved(page);
  expect(
    await select(
      L,
      `task_relations?select=side,anchor&task_id=eq.${(await select<{ id: string }>(L, `tasks?select=id&title=eq.${id} 本项目`))[0]!.id}`,
    ),
  ).toEqual([{ side: 'end', anchor: 'end' }]);

  // 循环任务：没有开始 / 结束两行；数据库也拒绝
  await projectLink(page, `${id}二`).click();
  await open(page, `${id} 循环`);
  await expect(startRow(page)).toHaveCount(0);
  const [loop] = await select<{ id: string }>(L, `tasks?select=id&title=eq.${id} 循环`);
  await expect(schedule(L, loop!.id, { start: localDate(1) })).rejects.toThrow(/没有任务关系/);
  const [mine] = await select<{ id: string }>(L, `tasks?select=id&title=eq.${id} 本项目`);
  await expect(
    schedule(L, mine!.id, { startRelations: [{ predecessor_id: loop!.id, anchor: 'end' }] }),
  ).rejects.toThrow(/不能选这个任务/);
  // 有关系的任务不能改成循环任务
  const [other] = await select<{ id: string }>(L, `tasks?select=id&title=eq.${id} 别的项目`);
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/tasks?id=eq.${other!.id}`,
    {
      method: 'PATCH',
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${await (await import('./auth')).accessTokenFor(L)}`,
        'Content-Profile': 'taskapp',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recurrence_rule: 'FREQ=DAILY',
        recurrence_dtstart: `${localDate(0)}T09:00:00+08:00`,
      }),
    },
  );
  expect(await response.text()).toMatch(/有任务关系的任务不能设为循环任务/);

  // 不能跨组：别的组的任务不能选
  const otherGroup = await groupWith(L, [], `${id}别的组`);
  const op = await projectIn(L, otherGroup, `${id}外`, ['relations']);
  const outsider = await groupTask(L, op, `${id} 别的组的任务`);
  await expect(
    schedule(L, mine!.id, { startRelations: [{ predecessor_id: outsider, anchor: 'end' }] }),
  ).rejects.toThrow(/不能选这个任务/);

  // 个人：分类开了任务关系的任务之间可以关联，跨分类也可以；不能和组任务关联
  await sidebar(page).getByRole('link', { name: /总览/ }).click();
  for (const [name, tools] of [
    [`${id}关系甲`, ['relations']],
    [`${id}关系乙`, ['relations']],
    [`${id}普通`, []],
  ] as const) {
    await sidebar(page).getByRole('button', { name: '+ 新建分类' }).click();
    const form = page.getByRole('form', { name: '新建分类' });
    await form.getByLabel('分类名称', { exact: true }).fill(name);
    if (tools.length) await form.getByRole('checkbox', { name: '任务关系' }).check();
    await form.getByRole('button', { name: '添加分类' }).click();
    await expect(form).toHaveCount(0);
  }
  const cats = await select<{ id: string; name: string }>(
    L,
    `categories?select=id,name&name=like.${id}*`,
  );
  const catId = (name: string) => cats.find((c) => c.name === name)!.id;
  const personal = async (title: string, category: string, deadline?: string) => {
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/tasks`, {
      method: 'POST',
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${await (await import('./auth')).accessTokenFor(L)}`,
        'Content-Profile': 'taskapp',
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ title, owner_id: await userId(L), deadline_at: deadline ?? null }),
    });
    const [task] = (await response.json()) as { id: string }[];
    await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/task_categories`, {
      method: 'POST',
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${await (await import('./auth')).accessTokenFor(L)}`,
        'Content-Profile': 'taskapp',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ task_id: task!.id, category_id: catId(category) }),
    });
    return task!.id;
  };
  await personal(`${id} 个人甲`, `${id}关系甲`);
  await personal(`${id} 个人乙`, `${id}关系乙`, `${localDate(7)}T23:59:59.999+08:00`);
  const plainId = await personal(`${id} 个人普通`, `${id}普通`);
  await page.reload();
  await categoryItem(page, `${id}关系甲`).click();
  const personalPanel = await open(page, `${id} 个人甲`);
  await startRow(page).getByRole('radio', { name: '关系' }).click();
  const pStarts = personalPanel.getByRole('list', { name: '开始的关系' });
  // 默认是当前选中的分类；只列出开了任务关系的分类
  await expect(pStarts.getByLabel('项目或分类')).toHaveValue(catId(`${id}关系甲`));
  await expect(pStarts.getByLabel('项目或分类').locator('option')).toHaveText([
    `${id}关系甲`,
    `${id}关系乙`,
  ]);
  await pStarts.getByLabel('项目或分类').selectOption({ label: `${id}关系乙` });
  await pStarts.getByLabel('关系对象').selectOption({ label: `${id} 个人乙` });
  await expect(startRow(page).getByLabel('算出的开始')).toHaveText(dayLabel(localDate(7)));
  await waitSaved(page);
  const [pa] = await select<{ id: string; start_on: string }>(
    L,
    `tasks?select=id,start_on&title=eq.${id} 个人甲`,
  );
  expect(pa!.start_on).toBe(localDate(7));
  await expect(
    schedule(L, pa!.id, { startRelations: [{ predecessor_id: mine!.id, anchor: 'end' }] }),
  ).rejects.toThrow(/不能选这个任务/);
  await expect(
    schedule(L, pa!.id, { startRelations: [{ predecessor_id: plainId, anchor: 'end' }] }),
  ).rejects.toThrow(/不能选这个任务/);
  await page.context().close();
});

test('不能形成循环：保存时拒绝', async ({ browser }) => {
  const id = runId();
  const L = await user('cl', `${id}组长`);
  const groupId = await groupWith(L, [], `${id}组`);
  const projectId = await projectIn(L, groupId, `${id}项目`, ['relations']);
  const a = await groupTask(L, projectId, `${id} 甲`);
  await groupTask(L, projectId, `${id} 乙`);
  const [b] = await select<{ id: string }>(L, `tasks?select=id&title=eq.${id} 乙`);
  await schedule(L, b!.id, { startRelations: [{ predecessor_id: a, anchor: 'end' }] });
  const page = await openAs(browser, L);
  await projectLink(page, `${id}项目`).click();
  const panel = await open(page, `${id} 甲`);
  await startRow(page).getByRole('radio', { name: '关系' }).click();
  const starts = panel.getByRole('list', { name: '开始的关系' });
  await starts.getByLabel('关系对象').selectOption({ label: `${id} 乙` });
  // 点 ✓ 保存时被拒绝，面板留着
  await panel.getByRole('button', { name: '完成编辑' }).first().click();
  await expect(panel.locator('.panel-message')).toContainText('任务关系不能形成循环');
  expect(await select(L, `task_relations?select=id&task_id=eq.${a}`)).toEqual([]);
  await page.context().close();
});

test('前置改日期后，依赖它的任务自动重算；开了任务分配的项目里通知执行人"修改了截止时间"，操作者是改前置的人', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const id = runId();
  const L = await user('rl', `${id}组长`);
  const R = await user('rr', `${id}执行`);
  const groupId = await groupWith(L, [R], `${id}组`, 'management');
  const projectId = await projectIn(L, groupId, `${id}项目`, ['assignment', 'relations']);
  const raci = [
    { role: 'R' as const, userId: await userId(R) },
    { role: 'A' as const, userId: await userId(L) },
  ];
  const a = await groupTask(L, projectId, `${id} 前置`, raci);
  const b = await groupTask(L, projectId, `${id} 后续`, raci);
  await schedule(L, a, { start: localDate(1), after: 2 });
  await schedule(L, b, {
    startRelations: [{ predecessor_id: a, anchor: 'end', offset_days: 1 }],
    after: 1,
  });
  // 先把建任务时的通知处理掉
  for (const n of await rpc<{ id: string; kind: string }[]>(R, 'my_notifications')) {
    if (n.kind === 'task') await rpc(R, 'dismiss_notification', { p_id: n.id });
  }

  const page = await openAs(browser, L);
  await projectLink(page, `${id}项目`).click();
  await expect(taskItem(page, `${id} 后续`).locator('.task-deadline')).toContainText(
    dayLabel(localDate(5)).split(' ')[0]!,
  );
  // 前置的开始往后挪 3 天
  await open(page, `${id} 前置`);
  await startRow(page).getByLabel('开始日期', { exact: true }).fill(localDate(4));
  await waitSaved(page);
  await expect(taskItem(page, `${id} 后续`).locator('.task-deadline')).toContainText(
    dayLabel(localDate(8)).split(' ')[0]!,
  );
  const [after] = await select<{ start_on: string }>(L, `tasks?select=start_on&id=eq.${b}`);
  expect(after!.start_on).toBe(localDate(7));

  const pr = await openAs(browser, R);
  await bell(pr).click();
  await expect(
    notificationList(pr)
      .locator('.notification-text')
      .filter({ hasText: `${id} 后续` }),
  ).toHaveText(`${id}组长修改了${id} 后续的截止时间`);
  await Promise.all([page, pr].map((p) => p.context().close()));
});

test('等待：简介行写"等待 某任务 开始 / 结束"，多个时加剩余数量；对方完成（确认）后不再等待；等开始时逐层判断', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const id = runId();
  const L = await user('wl', `${id}组长`);
  const groupId = await groupWith(L, [], `${id}组`);
  const projectId = await projectIn(L, groupId, `${id}项目`, ['relations']);
  const a = await groupTask(L, projectId, `${id} 设计`);
  const c = await groupTask(L, projectId, `${id} 采购`);
  const b = await groupTask(L, projectId, `${id} 开发`);
  const d = await groupTask(L, projectId, `${id} 联调`);
  await schedule(L, b, {
    startRelations: [
      { predecessor_id: a, anchor: 'end' },
      { predecessor_id: c, anchor: 'end' },
    ],
  });
  // 联调等开发开始；开发的开始又等设计、采购结束
  await schedule(L, d, { startRelations: [{ predecessor_id: b, anchor: 'start' }] });
  const page = await openAs(browser, L);
  await projectLink(page, `${id}项目`).click();
  await expect(taskItem(page, `${id} 开发`).locator('.task-waiting')).toHaveText(
    `等待 ${id} 设计 结束 +1`,
  );
  await expect(taskItem(page, `${id} 联调`).locator('.task-waiting')).toHaveText(
    `等待 ${id} 开发 开始`,
  );
  // 等待中的任务状态不变：仍在未完成里
  await expect(taskItem(page, `${id} 开发`)).toBeVisible();
  await page.getByRole('checkbox', { name: `完成：${id} 设计` }).click();
  await expect(taskItem(page, `${id} 开发`).locator('.task-waiting')).toHaveText(
    `等待 ${id} 采购 结束`,
  );
  await page.getByRole('checkbox', { name: `完成：${id} 采购` }).click();
  await expect(taskItem(page, `${id} 开发`).locator('.task-waiting')).toHaveCount(0);
  await expect(taskItem(page, `${id} 联调`).locator('.task-waiting')).toHaveCount(0);
  await page.context().close();
});

test('甘特图：入口（项目、开了任务关系的分类；组页面没有）、未排期、点任务条回清单展开', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const id = runId();
  const L = await user('gl', `${id}组长`);
  const groupId = await groupWith(L, [], `${id}组`);
  const rel = await projectIn(L, groupId, `${id}有关系`, ['relations']);
  await projectIn(L, groupId, `${id}没关系`, []);
  await projectIn(L, groupId, `${id}两个都开`, ['assignment', 'relations']);
  const many: string[] = [];
  for (let i = 0; i < 12; i++) {
    many.push(await groupTask(L, rel, `${id} 任务${String(i).padStart(2, '0')}`));
    await schedule(L, many[i]!, { start: localDate(i), after: 1 });
  }
  await groupTask(L, rel, `${id} 没日期`);
  const page = await openAs(browser, L);

  // 组页面：没有看法切换
  await groupLink(page, `${id}组`).click();
  await expect(page.getByRole('link', { name: '切换到甘特图' })).toHaveCount(0);
  // 没开任务关系的项目：没有甘特图
  await projectLink(page, `${id}没关系`).click();
  await expect(page.getByRole('link', { name: '切换到甘特图' })).toHaveCount(0);
  // 两个都开：清单、责任分配矩阵、甘特图并列
  await projectLink(page, `${id}两个都开`).click();
  await expect(page.getByRole('group', { name: '看法' }).getByRole('link')).toHaveCount(3);

  await projectLink(page, `${id}有关系`).click();
  const titleBefore = (await page.locator('h1.title-bar').boundingBox())!;
  const inputBefore = (await page.getByLabel('快速添加任务').boundingBox())!;
  await page.getByRole('link', { name: '切换到甘特图' }).click();
  await expect(page).toHaveURL(/view=gantt/);
  // 标题行和快捷添加栏的位置不变
  expect((await page.locator('h1.title-bar').boundingBox())!).toEqual(titleBefore);
  expect((await page.getByLabel('快速添加任务').boundingBox())!).toEqual(inputBefore);
  // 一个任务一行，按开始日期排序；有"今天"的竖线；刻度可以切换
  await expect(page.locator('.gantt-row')).toHaveCount(12);
  await expect(page.locator('.gantt-row').first()).toContainText(`${id} 任务00`);
  await expect(page.getByTestId('gantt-today')).toHaveCount(1);
  await page.getByRole('radio', { name: '月' }).click();
  await expect(page.getByRole('radio', { name: '月' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: '日' }).click();
  // 未排期：两个日期都没有
  await expect(page.getByRole('region', { name: '未排期' })).toContainText(`${id} 没日期`);
  // 点任务条：回到清单，原地展开并滚动到屏幕中间
  await page
    .locator('.gantt-row')
    .filter({ hasText: `${id} 任务11` })
    .locator('.gantt-bar')
    .click();
  await expect(page).not.toHaveURL(/view=gantt/);
  await expect(taskItem(page, `${id} 任务11`)).toHaveClass(/task-item-open/);
  await expect
    .poll(async () => {
      const row = (await taskItem(page, `${id} 任务11`).locator('.task-row').boundingBox())!;
      return Math.abs(row.y + row.height / 2 - page.viewportSize()!.height / 2);
    })
    .toBeLessThan(page.viewportSize()!.height / 3);

  // 个人：开了任务关系的分类页面才有清单 / 甘特图的切换
  await sidebar(page).getByRole('link', { name: /总览/ }).click();
  await expect(page.getByRole('link', { name: '切换到甘特图' })).toHaveCount(0);
  for (const [name, on] of [
    [`${id}关系`, true],
    [`${id}普通`, false],
  ] as const) {
    await sidebar(page).getByRole('button', { name: '+ 新建分类' }).click();
    const form = page.getByRole('form', { name: '新建分类' });
    await form.getByLabel('分类名称', { exact: true }).fill(name);
    if (on) await form.getByRole('checkbox', { name: '任务关系' }).check();
    await form.getByRole('button', { name: '添加分类' }).click();
    await expect(form).toHaveCount(0);
  }
  const relCat = categoryItem(page, `${id}关系`);
  const plainCat = categoryItem(page, `${id}普通`);
  await plainCat.click();
  await expect(page.getByRole('link', { name: '切换到甘特图' })).toHaveCount(0);
  await relCat.click();
  await page.getByRole('link', { name: '切换到甘特图' }).click();
  await expect(page).toHaveURL(/view=gantt/);
  await expect(page.locator('.gantt')).toBeVisible();
  // 换到另一个分类：回到清单
  await plainCat.click();
  await expect(page).not.toHaveURL(/view=gantt/);
  await expect(page.getByRole('link', { name: '切换到甘特图' })).toHaveCount(0);
  await page.context().close();
});

test('甘特图：执行人写在任务名后面；关系画成箭头；浮动时间和关键路径', async ({ browser }) => {
  const id = runId();
  const L = await user('kl', `${id}组长`);
  const R = await user('kr', `${id}执行`);
  const groupId = await groupWith(L, [R], `${id}组`, 'management');
  const projectId = await projectIn(L, groupId, `${id}项目`, ['assignment', 'relations']);
  const raci = [
    { role: 'R' as const, userId: await userId(R) },
    { role: 'A' as const, userId: await userId(L) },
  ];
  const a = await groupTask(L, projectId, `${id} 甲`, raci);
  const b = await groupTask(L, projectId, `${id} 乙`, raci);
  const c = await groupTask(L, projectId, `${id} 丙`, raci);
  await schedule(L, a, { start: localDate(1), after: 2 });
  await schedule(L, b, {
    startRelations: [{ predecessor_id: a, anchor: 'end', offset_days: 1 }],
    after: 4,
  });
  await schedule(L, c, { startRelations: [{ predecessor_id: a, anchor: 'end' }], after: 0 });
  const page = await openAs(browser, L);
  await page.goto(`/?group=${groupId}&project=${projectId}&view=gantt&status=all`);
  const row = (title: string) => page.locator('.gantt-row').filter({ hasText: title });
  await expect(row(`${id} 甲`)).toContainText(`${id}执行`);
  // 甲 → 乙 是关键路径，丙有浮动时间
  await expect(row(`${id} 甲`).locator('.gantt-bar')).toHaveClass(/gantt-critical/);
  await expect(row(`${id} 乙`).locator('.gantt-bar')).toHaveClass(/gantt-critical/);
  await expect(row(`${id} 丙`).locator('.gantt-bar')).not.toHaveClass(/gantt-critical/);
  await expect(row(`${id} 丙`).locator('.gantt-float')).toHaveCount(1);
  await expect(page.locator('.gantt-link')).toHaveCount(2);
  await expect(page.locator(`.gantt-link[data-from="${a}"][data-to="${b}"]`)).toHaveClass(
    /gantt-link-critical/,
  );
  // 状态：完成后（待确认）条的样式变了
  await rpc(R, 'ensure_current_user', { p_email: R.email, p_display_name: R.name });
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/tasks?id=eq.${c}`, {
    method: 'PATCH',
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${await (await import('./auth')).accessTokenFor(R)}`,
      'Content-Profile': 'taskapp',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ completed_at: new Date().toISOString() }),
  });
  expect(response.ok).toBe(true);
  await page.reload();
  await expect(row(`${id} 丙`).locator('[data-milestone]')).toHaveClass(/gantt-pending/);
  await selectStatus(page, '未完成');
  await expect(row(`${id} 丙`)).toHaveCount(0);
  await page.context().close();
});

test('开始 / 结束各分两层（条件类型、内容）；默认一个条件，"＋"再加一个；简介行只显示开始那一行的等待', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const id = runId();
  const L = await user('tl', `${id}组长`);
  const groupId = await groupWith(L, [], `${id}组`);
  const projectId = await projectIn(L, groupId, `${id}项目`, ['relations']);
  const a = await groupTask(L, projectId, `${id} 甲`);
  const b = await groupTask(L, projectId, `${id} 乙`);
  const c = await groupTask(L, projectId, `${id} 丙`);
  await groupTask(L, projectId, `${id} 丁`);
  await schedule(L, a, { start: localDate(1), after: 2 });
  // 乙的开始等甲结束；丙已经开始了，只有结束等甲
  await schedule(L, b, { startRelations: [{ predecessor_id: a, anchor: 'end' }], after: 2 });
  await schedule(L, c, {
    start: localDate(-1),
    endRelations: [{ predecessor_id: a, anchor: 'end' }],
  });
  const page = await openAs(browser, L);
  await projectLink(page, `${id}项目`).click();

  // 简介行：乙在等甲结束；丙的等待在结束那一行，不显示
  await expect(taskItem(page, `${id} 乙`).locator('.task-waiting')).toHaveText(
    `等待 ${id} 甲 结束`,
  );
  await expect(taskItem(page, `${id} 丙`).locator('.task-waiting')).toHaveCount(0);
  // 丙的结束条件在详情里
  let panel = await open(page, `${id} 丙`);
  const cEnds = panel.getByRole('list', { name: '结束的关系' });
  await expect(cEnds.getByLabel('关系对象')).toHaveValue(a);
  await waitSaved(page);

  // 两层：第一层是条件类型，第二层是内容
  panel = await open(page, `${id} 乙`);
  const firstLayer = startRow(page).locator('.schedule-row');
  const secondLayer = startRow(page).locator('.schedule-content');
  await expect(firstLayer.getByRole('radiogroup', { name: '开始的方式' })).toBeVisible();
  await expect(secondLayer.getByRole('list', { name: '开始的关系' })).toBeVisible();
  const firstBox = (await firstLayer.boundingBox())!;
  const secondBox = (await secondLayer.boundingBox())!;
  expect(secondBox.y).toBeGreaterThanOrEqual(firstBox.y + firstBox.height - 1);
  await expect(endRow(page).locator('.schedule-content').getByLabel('开始后的天数')).toHaveValue(
    '2',
  );
  // 一个条件；"＋"在它旁边，再加一个
  const starts = panel.getByRole('list', { name: '开始的关系' });
  await expect(starts.getByLabel('关系对象')).toHaveCount(1);
  await starts.getByRole('button', { name: '添加开始的关系' }).click();
  await expect(starts.getByLabel('关系对象')).toHaveCount(2);
  await expect(starts.getByRole('button', { name: '添加开始的关系' })).toHaveCount(1);
  await starts
    .getByLabel('关系对象')
    .nth(1)
    .selectOption({ label: `${id} 丁` });
  await waitSaved(page);
  expect(
    (
      await select<{ predecessor_id: string }>(
        L,
        `task_relations?select=predecessor_id&task_id=eq.${b}&side=eq.start`,
      )
    )
      .map((r) => r.predecessor_id)
      .sort(),
  ).toHaveLength(2);

  // 没有关系的一行切到"关系"：默认就有一个空条件
  panel = await open(page, `${id} 丁`);
  await endRow(page).getByRole('radio', { name: '关系' }).click();
  const dEnds = panel.getByRole('list', { name: '结束的关系' });
  await expect(dEnds.getByLabel('关系对象')).toHaveCount(1);
  await expect(dEnds.getByLabel('关系对象')).toHaveValue('');
  // 只换了类型、没选关系对象：不算改动，Esc 直接收起
  await page.keyboard.press('Escape');
  await expect(editPanel(page)).toHaveCount(0);
  await page.context().close();
});

test('甘特图：每天一条线；同一天结束和开始的任务在同一条线上；同一天、只有开始、只有结束的是那天线上的菱形；今天是今天那条线', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const id = runId();
  const L = await user('gl', `${id}组长`);
  const groupId = await groupWith(L, [], `${id}组`);
  const projectId = await projectIn(L, groupId, `${id}项目`, ['relations']);
  const a = await groupTask(L, projectId, `${id} 甲`);
  const b = await groupTask(L, projectId, `${id} 乙`);
  const same = await groupTask(L, projectId, `${id} 同一天`);
  const startOnly = await groupTask(L, projectId, `${id} 只有开始`);
  await groupTask(L, projectId, `${id} 只有结束`, [], {
    deadline_at: `${localDate(6)}T23:59:59.999+08:00`,
  });
  await schedule(L, a, { start: localDate(1), after: 2 });
  await schedule(L, b, { startRelations: [{ predecessor_id: a, anchor: 'end' }], after: 3 });
  await schedule(L, same, { start: localDate(2), after: 0 });
  await schedule(L, startOnly, { start: localDate(4) });
  const page = await openAs(browser, L);
  await projectLink(page, `${id}项目`).click();
  await page.getByRole('link', { name: '切换到甘特图' }).click();
  await expect(page).toHaveURL(/view=gantt/);

  const row = (title: string) => page.locator('.gantt-row').filter({ hasText: `${id} ${title}` });
  const attr = async (title: string, name: string) =>
    Number(await row(title).locator('button').first().getAttribute(name));
  const lineX = async (date: string) => {
    const style = await page.locator(`.gantt-grid[data-date="${date}"]`).getAttribute('style');
    return Number(/left:\s*([\d.]+)px/.exec(style!)![1]);
  };
  // 甲在第 3 天结束、乙在第 3 天开始：同一条线
  expect(await attr('甲', 'data-x-end')).toBeCloseTo(await attr('乙', 'data-x'), 3);
  expect(await attr('甲', 'data-x-end')).toBeCloseTo(await lineX(localDate(3)), 3);
  expect(await attr('甲', 'data-x')).toBeCloseTo(await lineX(localDate(1)), 3);
  // 条的长度 = 天数 × 两天之间的距离（按字号算）
  const dayWidth = Number(await page.getByTestId('gantt-scroll').getAttribute('data-day-width'));
  const fontSize = await page
    .getByTestId('gantt-scroll')
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(dayWidth).toBeCloseTo(2.5 * fontSize, 3);
  expect((await attr('甲', 'data-x-end')) - (await attr('甲', 'data-x'))).toBeCloseTo(
    2 * dayWidth,
    3,
  );
  // 菱形：开始和结束同一天、只有开始、只有结束
  for (const [title, date] of [
    ['同一天', localDate(2)],
    ['只有开始', localDate(4)],
    ['只有结束', localDate(6)],
  ] as const) {
    await expect(row(title).locator('[data-milestone]')).toHaveCount(1);
    expect(await attr(title, 'data-x')).toBeCloseTo(await lineX(date), 3);
  }
  await expect(row('甲').locator('[data-milestone]')).toHaveCount(0);
  // 今天就是今天那条线
  const today = page.getByTestId('gantt-today');
  await expect(today).toHaveAttribute('data-date', localDate(0));
  const todayStyle = (await today.getAttribute('style'))!;
  expect(Number(/left:\s*([\d.]+)px/.exec(todayStyle)![1])).toBeCloseTo(
    await lineX(localDate(0)),
    3,
  );
  // 周、月刻度同样按字号算
  await page.getByRole('radiogroup', { name: '刻度' }).getByRole('radio', { name: '周' }).click();
  await expect
    .poll(async () => Number(await page.getByTestId('gantt-scroll').getAttribute('data-day-width')))
    .toBeCloseTo(0.9 * fontSize, 3);
  await page.context().close();
});
