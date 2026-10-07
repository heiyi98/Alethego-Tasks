import { expect, test, type Locator, type Page } from '@playwright/test';

import { accessTokenFor } from './auth';
import {
  bell,
  editGroup,
  groupLink,
  groupSection,
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
  createCategory,
  editPanel,
  localDate,
  quickAdd,
  runId,
  selectStatus,
  statusBar,
  taskItem,
} from './helpers';

// 多个账号各用自己的浏览器上下文：从"没登录"开始
test.use({ storageState: { cookies: [], origins: [] } });

interface NotificationRow {
  kind: string;
  action: string | null;
  task_title: string | null;
  actor_name: string;
  subject_name: string | null;
  subject_is_me: boolean | null;
  fields: string[] | null;
}

/** 某人现在收到的任务通知：[动作, 对象（你 / 名字 / 空）, 改动的字段] */
async function taskNotifications(u: GroupUser, title: string) {
  const rows = await rpc<NotificationRow[]>(u, 'my_notifications');
  return rows
    .filter((n) => n.kind === 'task' && n.task_title === title)
    .map((n) => [
      n.action,
      n.subject_is_me ? '你' : (n.subject_name ?? ''),
      (n.fields ?? []).join('+'),
    ])
    .sort((a, b) => a.join().localeCompare(b.join()));
}

const box = async (page: Page, selector: string) => (await page.locator(selector).boundingBox())!;

test('左下角：账号名和铃铛固定不动；通知以窗口出现在铃铛上方，没有通知时显示"没有通知"', async ({
  browser,
}) => {
  const id = runId();
  const me = await user('corner', `${id}我`);
  const page = await openAs(browser, me);
  const viewport = page.viewportSize()!;

  const account = await box(page, '.account-current');
  const bellBox = (await bell(page).boundingBox())!;
  // 在侧边栏的左下角
  expect(account.x).toBeLessThan(40);
  expect(viewport.height - (account.y + account.height)).toBeLessThan(30);
  expect(Math.abs(bellBox.y + bellBox.height / 2 - (account.y + account.height / 2))).toBeLessThan(
    2,
  );

  // 打开通知：窗口在铃铛上方，账号和铃铛都不动，下面也没有多出一行
  await bell(page).click();
  const panel = notificationList(page);
  await expect(panel).toHaveText('没有通知');
  const panelBox = (await panel.boundingBox())!;
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(bellBox.y);
  expect(await box(page, '.account-current')).toEqual(account);
  expect(await bell(page).boundingBox()).toEqual(bellBox);
  // 点窗口外面关闭
  await page.locator('main').click({ position: { x: 600, y: 400 } });
  await expect(panel).toHaveCount(0);

  // 打开账号菜单：同样从上方弹出，不改变位置
  await page.locator('.account-current').click();
  await expect(sidebar(page).locator('.account-panel')).toBeVisible();
  expect(await box(page, '.account-current')).toEqual(account);
  expect(await bell(page).boundingBox()).toEqual(bellBox);
  await page.locator('.account-current').click();

  // 侧边栏内容变多（很多分类）时也不动
  for (let i = 0; i < 12; i++) await createCategory(page, `${id}分类${i}`);
  expect(await box(page, '.account-current')).toEqual(account);
  expect(await bell(page).boundingBox()).toEqual(bellBox);
  await page.context().close();
});

test('通知：结构化记录拼成一句话；收件人按动作决定；只发给项目成员，不发给自己；同一种通知合并改动的字段', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const id = runId();
  const L = await user('nl', `${id}组长`);
  const R = await user('nr', `${id}执行`);
  const A = await user('na', `${id}负责`);
  const I = await user('ni', `${id}知会`);
  const O = await user('no', `${id}旁观`);
  const groupId = await groupWith(L, [R, A, I, O], `${id}组`, 'management');
  const projectId = await projectIn(L, groupId, `${id}项目`, ['assignment']);
  const contact = await rpc<{ id: string }>(L, 'add_project_contact', {
    p_project_id: projectId,
    p_name: `${id}外人`,
  });
  const [rId, aId, iId] = await Promise.all([userId(R), userId(A), userId(I)]);
  const title = `${id}任务一`;
  const taskId = await groupTask(L, projectId, title, [
    { role: 'R', userId: rId },
    { role: 'A', userId: aId },
    { role: 'I', userId: iId },
    { role: 'I', contactId: contact.id },
  ]);

  // 设为执行人：被设的人和知会；建任务时设的负责人、知会不算"修改"
  expect(await taskNotifications(R, title)).toEqual([['assigned', '你', '']]);
  expect(await taskNotifications(I, title)).toEqual([['assigned', `${id}执行`, '']]);
  expect(await taskNotifications(A, title)).toEqual([]);
  expect(await taskNotifications(L, title)).toEqual([]);
  expect(await taskNotifications(O, title)).toEqual([]);

  // 修改（描述、截止时间、负责人、人物）：执行人和知会；同一条通知合并改动的字段
  const update = async (u: GroupUser, body: object) => {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/tasks?id=eq.${taskId}`,
      {
        method: 'PATCH',
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          Authorization: `Bearer ${await accessTokenFor(u)}`,
          'Content-Profile': 'taskapp',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    expect(response.ok, await response.clone().text()).toBe(true);
  };
  await update(L, { description: '新的描述' });
  await update(L, { deadline_at: new Date(Date.now() + 86_400_000).toISOString() });
  await rpc(L, 'set_task_raci', {
    p_task_id: taskId,
    p_assignments: [
      { role: 'R', user_id: rId },
      { role: 'A', user_id: await userId(L) },
      { role: 'I', user_id: iId },
    ],
  });
  expect(await taskNotifications(R, title)).toEqual([
    ['assigned', '你', ''],
    ['modified', '', 'description+deadline+A+I'],
  ]);
  expect(await taskNotifications(A, title)).toEqual([]);

  // 完成：负责人和知会；确认：执行人和知会
  await update(R, { completed_at: new Date().toISOString() });
  expect(await taskNotifications(L, title)).toEqual([['completed', '', '']]);
  // 退回：执行人和知会
  await update(L, { completed_at: null });
  expect(await taskNotifications(R, title)).toContainEqual(['rejected', '', '']);
  expect(await taskNotifications(I, title)).toContainEqual(['rejected', '', '']);
  await update(R, { completed_at: new Date().toISOString() });
  await update(L, { confirmed_at: new Date().toISOString() });
  expect(await taskNotifications(R, title)).toContainEqual(['confirmed', '', '']);
  expect(await taskNotifications(I, title)).toContainEqual(['confirmed', '', '']);
  // 负责人自己确认的，不通知自己；确认后"完成"不用再处理
  expect(await taskNotifications(L, title)).toEqual([]);

  // 界面上拼成连贯的一句话
  const pi = await openAs(browser, I);
  await bell(pi).click();
  // 通知列表异步加载：等它出来再比
  await expect
    .poll(() => notificationList(pi).locator('.notification-text').allTextContents())
    .toEqual(
      expect.arrayContaining([
        `${id}组长把${id}执行设为${title}的执行人（R）`,
        `${id}执行完成了${title}`,
        `${id}组长确认了${title}`,
        `${id}组长退回了${title}`,
        `${id}组长修改了${title}的描述、截止时间、负责人（A）和知会（I）`,
      ]),
    );
  await pi.context().close();
});

test('开了任务分配的项目：快捷添加必须选执行人；执行人和负责人不能删到一个都不剩（数据库也拦住）', async ({
  browser,
}) => {
  const id = runId();
  const L = await user('rl', `${id}组长`);
  const M = await user('rm', `${id}组员`);
  const groupId = await groupWith(L, [M], `${id}组`, 'management');
  const projectId = await projectIn(L, groupId, `${id}项目`, ['assignment']);
  const page = await openAs(browser, L);
  await projectLink(page, `${id}项目`).click();

  const bar = page.locator('.quick-add');
  await page.getByLabel('快速添加任务').fill(`${id} 没选执行人`);
  await expect(bar.getByRole('combobox', { name: '负责人（A）' })).toHaveValue(await userId(L));
  await expect(bar.getByRole('button', { name: '创建', exact: true })).toBeDisabled();
  await bar.getByRole('combobox', { name: '执行人（R）' }).selectOption({ label: `${id}组员` });
  await bar.getByRole('button', { name: '创建', exact: true }).click();
  await expect(taskItem(page, `${id} 没选执行人`)).toBeVisible();
  // 简介行：时间、执行人、负责人
  await expect(taskItem(page, `${id} 没选执行人`).locator('.task-raci')).toHaveText([
    `R${id}组员`,
    `A${id}组长`,
  ]);

  // 数据库：不带执行人和负责人建不了；删光也不行
  await expect(
    rpc(L, 'create_task_with_raci', {
      p_project_id: projectId,
      p_title: 'x',
      p_description: '',
      p_deadline_at: null,
      p_recurrence_rule: null,
      p_recurrence_dtstart: null,
      p_assignments: [{ role: 'A', user_id: await userId(L) }],
    }),
  ).rejects.toThrow(/必须有执行人和负责人/);
  const taskId = await groupTask(L, projectId, `${id} 已有`, [
    { role: 'R', userId: await userId(M) },
    { role: 'A', userId: await userId(L) },
  ]);
  await expect(
    rpc(L, 'set_task_raci', {
      p_task_id: taskId,
      p_assignments: [{ role: 'A', user_id: await userId(L) }],
    }),
  ).rejects.toThrow(/必须有执行人和负责人/);
  await expect(
    rpc(L, 'set_task_raci', {
      p_task_id: taskId,
      p_assignments: [{ role: 'R', user_id: await userId(M) }],
    }),
  ).rejects.toThrow(/必须有执行人和负责人/);
  await page.context().close();
});

test('简介行一直存在、高度固定：个人、没开和开了任务分配的项目的任务行一样高', async ({
  browser,
}) => {
  const id = runId();
  const L = await user('hl', `${id}组长`);
  const M = await user('hm', `${id}组员`);
  const coopId = await groupWith(L, [M], `${id}合作`);
  const mgmtId = await groupWith(L, [M], `${id}管理`, 'management');
  await groupTask(L, await projectIn(L, coopId, `${id}合作项目`), `${id} 合作组任务`);
  await groupTask(
    L,
    await projectIn(L, mgmtId, `${id}分配项目`, ['assignment']),
    `${id} 管理组任务`,
    [
      { role: 'R', userId: await userId(M) },
      { role: 'A', userId: await userId(L) },
    ],
  );
  const page = await openAs(browser, L);
  await quickAdd(page, `${id} 没有简介`);
  await quickAdd(page, `${id} 有截止和重要性`, { deadline: localDate(3), importance: 4 });
  for (let i = 0; i < 6; i++) await createCategory(page, `${id}很长的分类名称${i}`);

  const heights: number[] = [];
  for (const title of [`${id} 没有简介`, `${id} 有截止和重要性`]) {
    heights.push((await taskItem(page, title).locator('.task-row').boundingBox())!.height);
  }
  await projectLink(page, `${id}合作项目`).click();
  heights.push(
    (await taskItem(page, `${id} 合作组任务`).locator('.task-row').boundingBox())!.height,
  );
  await projectLink(page, `${id}分配项目`).click();
  heights.push(
    (await taskItem(page, `${id} 管理组任务`).locator('.task-row').boundingBox())!.height,
  );
  expect(new Set(heights).size).toBe(1);
  // 没有内容时简介行也在，只是空着
  await sidebar(page).getByRole('link', { name: /总览/ }).click();
  await expect(taskItem(page, `${id} 没有简介`).locator('.task-meta')).toHaveText('');
  await page.context().close();
});

test('待确认：在未完成和已完成之间；角标是待确认的任务数，0 时不显示；只在开了任务分配的项目里有', async ({
  browser,
}) => {
  const id = runId();
  const L = await user('pl', `${id}组长`);
  const M = await user('pm', `${id}组员`);
  const groupId = await groupWith(L, [M], `${id}管理`, 'management');
  const projectId = await projectIn(L, groupId, `${id}分配项目`, ['assignment']);
  await projectIn(L, groupId, `${id}普通项目`, ['relations']);
  const raci = [
    { role: 'R' as const, userId: await userId(M) },
    { role: 'A' as const, userId: await userId(L) },
  ];
  await groupTask(L, projectId, `${id} 一`, raci);
  await groupTask(L, projectId, `${id} 二`, raci);
  const page = await openAs(browser, M);
  await projectLink(page, `${id}分配项目`).click();
  await expect(statusBar(page).getByRole('button')).toHaveText([
    '全部',
    '未完成',
    '待确认',
    '已完成',
    '已错过',
  ]);
  const badge = statusBar(page).getByTestId('pending-badge');
  await expect(badge).toHaveCount(0);
  await page.getByRole('checkbox', { name: `完成：${id} 一` }).click();
  await expect(badge).toHaveText('1');
  await page.getByRole('checkbox', { name: `完成：${id} 二` }).click();
  await expect(badge).toHaveText('2');
  await selectStatus(page, '待确认');
  await page.getByRole('checkbox', { name: `完成：${id} 一` }).click();
  await expect(badge).toHaveText('1');
  // 组页面：有一个项目开了任务分配就有"待确认"，角标数这个组里的
  await groupLink(page, `${id}管理`).click();
  await expect(statusBar(page).getByRole('button', { name: /待确认/ })).toBeVisible();
  await expect(badge).toHaveText('1');
  // 没开任务分配的项目和个人没有"待确认"
  await projectLink(page, `${id}普通项目`).click();
  await expect(statusBar(page).getByRole('button')).toHaveText([
    '全部',
    '未完成',
    '已完成',
    '已错过',
  ]);
  await sidebar(page).getByRole('link', { name: /总览/ }).click();
  await expect(statusBar(page).getByRole('button')).toHaveText([
    '全部',
    '未完成',
    '已完成',
    '已错过',
  ]);
  await page.context().close();
});

test('通知里的"查看"：进入项目，把任务滚动到屏幕中间并在清单里原地展开', async ({ browser }) => {
  test.setTimeout(120_000);
  const id = runId();
  const L = await user('vl', `${id}组长`);
  const M = await user('vm', `${id}组员`);
  const groupId = await groupWith(L, [M], `${id}管理`, 'management');
  const projectId = await projectIn(L, groupId, `${id}项目`, ['assignment']);
  const raci = [
    { role: 'R' as const, userId: await userId(L) },
    { role: 'A' as const, userId: await userId(L) },
  ];
  // 很多任务，目标任务排在中间偏后（前面 25 条、后面 12 条），一开始不在屏幕里
  for (let i = 0; i < 25; i++) {
    await groupTask(L, projectId, `${id} 前面${String(i).padStart(2, '0')}`, raci, {
      deadline_at: new Date(Date.now() + (i + 1) * 3_600_000).toISOString(),
    });
  }
  const title = `${id} 目标`;
  await groupTask(
    L,
    projectId,
    title,
    [
      { role: 'R', userId: await userId(M) },
      { role: 'A', userId: await userId(L) },
    ],
    { deadline_at: new Date(Date.now() + 25.5 * 3_600_000).toISOString() },
  );
  for (let i = 0; i < 12; i++) {
    await groupTask(L, projectId, `${id} 后面${String(i).padStart(2, '0')}`, raci, {
      deadline_at: new Date(Date.now() + (30 + i) * 3_600_000).toISOString(),
    });
  }

  // 组员在总览页（不在组里），点"查看"
  const page = await openAs(browser, M);
  await bell(page).click();
  await notificationList(page)
    .getByRole('listitem')
    .filter({ hasText: title })
    .getByRole('button', { name: '查看' })
    .click();
  await expect(page).toHaveURL(new RegExp(`group=${groupId}&project=${projectId}`));
  const item = taskItem(page, title);
  await expect(item).toHaveClass(/task-item-open/);
  // 不是弹出窗口
  await expect(page.locator('.edit-panel-floating')).toHaveCount(0);
  // 滚动到屏幕中间
  await expect
    .poll(async () => {
      const row = (await item.locator('.task-row').boundingBox())!;
      return Math.abs(row.y + row.height / 2 - page.viewportSize()!.height / 2);
    })
    .toBeLessThan(page.viewportSize()!.height / 4);
  await page.context().close();
});

test('颜色可以重复：分类、组都能用别人已经在用的颜色；默认取还没用过的第一个', async ({
  browser,
}) => {
  const id = runId();
  const L = await user('cl', `${id}组长`);
  const page = await openAs(browser, L);

  // 分类：第一个默认红色，第二个默认黄色；手动把第二个改成红色也可以
  await createCategory(page, `${id}甲`);
  await sidebar(page).getByRole('button', { name: '+ 新建分类' }).click();
  const form = page.getByRole('form', { name: '新建分类' });
  await expect(form.getByRole('radio', { name: '#FFCC00' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(form.getByRole('radio', { name: '#FF3B30' })).toBeEnabled();
  await form.getByRole('radio', { name: '#FF3B30' }).click();
  await form.getByLabel('分类名称', { exact: true }).fill(`${id}乙`);
  await form.getByRole('button', { name: '添加分类' }).click();
  await expect(form).toHaveCount(0);
  const colors = await select<{ color: string }>(
    L,
    `categories?select=color&name=like.${id}*&order=name`,
  );
  expect(colors.map((c) => c.color)).toEqual(['#FF3B30', '#FF3B30']);

  // 组：两个组用同一个颜色
  await groupWith(L, [], `${id}一组`);
  await groupWith(L, [], `${id}二组`);
  await page.reload();
  for (const name of [`${id}一组`, `${id}二组`]) {
    const edit = await editGroup(page, name);
    await edit.getByRole('radio', { name: '#AF52DE' }).click();
    await edit.getByRole('button', { name: '保存' }).click();
    await expect(edit).toHaveCount(0);
  }
  for (const name of [`${id}一组`, `${id}二组`]) {
    await expect(groupLink(page, name).locator('.category-dot')).toHaveCSS(
      'background-color',
      'rgb(175, 82, 222)',
    );
  }
  // 新建组：默认取组里还没用过的第一个颜色
  await groupSection(page).getByRole('button', { name: '+ 新建组' }).click();
  await expect(
    groupSection(page)
      .getByRole('form', { name: '新建组' })
      .getByRole('radio', { name: '#FF3B30' }),
  ).toHaveAttribute('aria-checked', 'true');
  await page.context().close();
});

test('RACI 人名：简介行、详情、快速添加、责任分配矩阵、甘特图里都是等宽的格子（4 个汉字宽，按字号），放不下省略号', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const id = runId();
  const L = await user('wl', `${id}组长的名字很长`);
  const M = await user('wm', '王五');
  const groupId = await groupWith(L, [M], `${id}组`, 'management');
  const projectId = await projectIn(L, groupId, `${id}项目`, ['assignment', 'relations']);
  await groupTask(
    L,
    projectId,
    `${id} 宽度`,
    [
      { role: 'R', userId: await userId(M) },
      { role: 'R', userId: await userId(L) },
      { role: 'A', userId: await userId(L) },
    ],
    { deadline_at: `${localDate(3)}T23:59:59.999+08:00` },
  );
  const page = await openAs(browser, L);
  await projectLink(page, `${id}项目`).click();

  /** 每个格子的宽度与 4 个字（按它自己的字号）之比；以及放不下的有没有被截断 */
  const boxes = (locator: Locator) =>
    locator.evaluateAll((els) =>
      els.map((el) => {
        const style = getComputedStyle(el);
        return {
          ratio: el.getBoundingClientRect().width / (4 * parseFloat(style.fontSize)),
          clipped: el.scrollWidth > el.clientWidth,
          ellipsis: style.textOverflow,
        };
      }),
    );
  const expectEqualBoxes = async (locator: Locator, count: number) => {
    await expect(locator).toHaveCount(count);
    const all = await boxes(locator);
    for (const box of all) {
      expect(box.ratio).toBeCloseTo(1, 2);
      expect(box.ellipsis).toBe('ellipsis');
    }
    return all;
  };

  // 简介行：短名字和长名字一样宽，长的截断
  const row = taskItem(page, `${id} 宽度`);
  const summary = await expectEqualBoxes(row.locator('.task-raci .person-name'), 3);
  expect(summary.some((b) => b.clipped)).toBe(true);
  expect(summary.some((b) => !b.clipped)).toBe(true);

  // 详情里的 RACI
  await row.locator('.task-title').click();
  await expectEqualBoxes(editPanel(page).locator('.raci-chip .person-name'), 3);
  await page.keyboard.press('Escape');
  await expect(editPanel(page)).toHaveCount(0);

  // 快速添加：执行人、负责人两个选人框一样宽（名字部分 4 个汉字宽）
  await page.getByLabel('快速添加任务').fill(`${id} 新的`);
  const selects = page.locator('.quick-add .person-select');
  const widths = await selects.evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().width),
  );
  expect(widths).toHaveLength(2);
  expect(widths[0]).toBeCloseTo(widths[1]!, 1);
  await page.getByLabel('快速添加任务').fill('');

  // 责任分配矩阵的表头
  await page.getByRole('link', { name: '切换到责任分配矩阵' }).click();
  await expectEqualBoxes(
    page.getByRole('table', { name: '责任分配矩阵' }).locator('thead .person-name'),
    2,
  );

  // 甘特图里任务名后面的执行人
  await page.getByRole('link', { name: '切换到甘特图' }).click();
  await expectEqualBoxes(page.locator('.gantt-assignees .person-name'), 2);
  await page.context().close();
});
