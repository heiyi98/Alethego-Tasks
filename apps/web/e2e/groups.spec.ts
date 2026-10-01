import { expect, test, type Browser, type Page } from '@playwright/test';

import { accessTokenFor, loginViaUi, newCredentials, signUpUser, type Credentials } from './auth';
import { dbUrl, queryRest, quickAdd, runId, setDbClock, taskItem } from './helpers';

// 多个账号各用自己的浏览器上下文：从"没登录"开始
test.use({ storageState: { cookies: [], origins: [] } });

const sidebar = (page: Page) => page.getByRole('navigation', { name: '主菜单' });
const groupSection = (page: Page) => sidebar(page).getByRole('region', { name: '组' });
const groupLink = (page: Page, name: string) =>
  groupSection(page).getByRole('link', { name, exact: false });
const bell = (page: Page) => sidebar(page).getByRole('button', { name: '通知' });
const notificationList = (page: Page) => sidebar(page).getByRole('region', { name: '通知列表' });
const titleBar = (page: Page) => page.locator('h1.title-bar');

async function user(tag: string, name: string): Promise<Credentials & { name: string }> {
  const credentials = await signUpUser(newCredentials(tag), { full_name: name });
  return { ...credentials, name };
}

/** 一个账号一个浏览器上下文，经登录页登录（第一次登录也会自动建好 TaskApp 的用户行） */
async function openAs(browser: Browser, credentials: Credentials): Promise<Page> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto('/');
  await loginViaUi(page, credentials);
  return page;
}

/** 直接调数据库函数（准备数据用；按这个账号的身份） */
async function rpc<T>(credentials: Credentials, fn: string, args: object = {}): Promise<T> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${await accessTokenFor(credentials)}`,
      'Content-Profile': 'taskapp',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${fn}: ${response.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

/** 准备：甲建组，其余的人直接入组（接受邀请） */
async function groupWith(
  owner: Credentials & { name: string },
  members: (Credentials & { name: string })[],
  name: string,
): Promise<string> {
  for (const u of [owner, ...members]) {
    await rpc(u, 'ensure_current_user', { p_email: u.email, p_display_name: u.name });
  }
  const group = await rpc<{ id: string }>(owner, 'create_group', { p_name: name });
  for (const member of members) {
    await rpc(owner, 'invite_to_group', { p_group_id: group.id, p_email: member.email });
    // 被邀请人自己看得到发给他的邀请
    const [invitation] = await select<{ id: string }>(
      member,
      `group_invitations?select=id&group_id=eq.${group.id}`,
    );
    await rpc(member, 'accept_group_invitation', { p_invitation_id: invitation!.id });
  }
  return group.id;
}

/** 按这个账号的身份直接查表（RLS 决定看得到什么） */
async function select<T>(credentials: Credentials, path: string): Promise<T[]> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${await accessTokenFor(credentials)}`,
      'Accept-Profile': 'taskapp',
    },
  });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return (await response.json()) as T[];
}

async function openGroupPanel(page: Page) {
  const name = titleBar(page).getByRole('button');
  if ((await name.getAttribute('aria-expanded')) !== 'true') await name.click();
  await expect(page.locator('.group-panel')).toBeVisible();
  return page.locator('.group-panel');
}

test('建组、邀请（接受 / 拒绝）、昵称；组任务所有成员可见，非成员什么都看不到', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const id = runId();
  const a = await user('ga', `${id}甲`);
  const b = await user('gb', `${id}乙`);
  const c = await user('gc', `${id}丙`);
  const groupName = `${id}合作组`;

  // 甲：侧边栏「组」区新建组，建好后直接进入这个组
  const pa = await openAs(browser, a);
  await groupSection(pa).getByRole('button', { name: '+ 新建组' }).click();
  await groupSection(pa).getByRole('textbox', { name: '组名' }).fill(groupName);
  await groupSection(pa).getByRole('button', { name: '创建' }).click();
  await expect(pa).toHaveURL(/\?group=/);
  await expect(titleBar(pa)).toHaveText(groupName);
  await expect(groupLink(pa, groupName)).toHaveAttribute('aria-current', 'page');
  const groupId = new URL(pa.url()).searchParams.get('group')!;

  // 组里：没有清单 / 矩阵切换，快速添加没有重要性、收藏，展开后没有分类
  await expect(pa.getByRole('link', { name: '切换到矩阵' })).toHaveCount(0);
  const bar = pa.locator('.quick-add');
  await expect(bar.getByRole('group', { name: '重要性' })).toHaveCount(0);
  await bar.getByRole('button', { name: '展开完整选项' }).click();
  await expect(bar.getByRole('group', { name: '分类' })).toHaveCount(0);
  await expect(bar.getByRole('group', { name: '重要性' })).toHaveCount(0);
  await expect(bar.getByRole('button', { name: '标星' })).toHaveCount(0);
  await expect(bar.getByRole('group', { name: '地点' })).toBeVisible();
  await expect(bar.getByRole('group', { name: '人物' })).toBeVisible();
  await bar.getByRole('button', { name: '收起' }).click();
  await quickAdd(pa, `${id} 甲建的组任务`);
  const row = taskItem(pa, `${id} 甲建的组任务`);
  await expect(row.getByRole('button', { name: '标星' })).toHaveCount(0);
  // 展开的面板里同样没有重要性、分类、收藏
  await row.locator('.task-main').click();
  const panel = pa.getByRole('form', { name: '编辑任务' });
  await expect(panel.getByRole('group', { name: '地点' })).toBeVisible();
  await expect(panel.getByRole('group', { name: '重要性' })).toHaveCount(0);
  await expect(panel.getByRole('group', { name: '分类' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '标星' })).toHaveCount(0);
  await panel.getByRole('button', { name: '完成编辑' }).click();

  // 落库：任务记下所属的组，重要性 0、没有标星
  const [stored] = await queryRest<
    { group_id: string; importance_level: number; is_starred: boolean }[]
  >(pa.request, `tasks?select=group_id,importance_level,is_starred&title=eq.${id} 甲建的组任务`, a);
  expect(stored).toEqual({ group_id: groupId, importance_level: 0, is_starred: false });

  // 组任务不出现在总览里
  await sidebar(pa).getByRole('link', { name: /总览/ }).click();
  await expect(titleBar(pa)).toHaveText('总览');
  await expect(pa.getByLabel('快速添加任务')).toBeVisible();
  await expect(taskItem(pa, `${id} 甲建的组任务`)).toHaveCount(0);
  await expect(pa.getByRole('link', { name: '切换到矩阵' })).toBeVisible();

  // 邀请：输入邮箱（不发邮件）
  await groupLink(pa, groupName).click();
  const groupPanel = await openGroupPanel(pa);
  const invite = groupPanel.getByRole('form', { name: '邀请' });
  for (const u of [b, c]) {
    await invite.getByRole('textbox', { name: '邀请的邮箱' }).fill(u.email);
    await invite.getByRole('button', { name: '邀请' }).click();
    await expect(invite.getByRole('status')).toHaveText(`已邀请：${u.email}`);
  }
  await invite.getByRole('textbox', { name: '邀请的邮箱' }).fill(b.email.toUpperCase());
  await invite.getByRole('button', { name: '邀请' }).click();
  await expect(invite.getByRole('status')).toHaveText(`已经邀请过：${b.email}`);
  await invite.getByRole('textbox', { name: '邀请的邮箱' }).fill(a.email);
  await invite.getByRole('button', { name: '邀请' }).click();
  await expect(invite.getByRole('status')).toHaveText(`不能邀请自己：${a.email}`);

  // 乙第一次登录 TaskApp：通知图标带小圆点，点开看到邀请，同意后组出现在侧边栏
  const pb = await openAs(browser, b);
  await expect(bell(pb)).toHaveAttribute('data-unread', 'true');
  await bell(pb).click();
  const invitation = notificationList(pb).getByRole('listitem');
  await expect(invitation).toHaveText(new RegExp(`${id}甲 邀请你加入「${groupName}」`));
  await expect(bell(pb)).not.toHaveAttribute('data-unread', 'true');
  await invitation.getByRole('button', { name: '同意', exact: true }).click();
  await expect(groupLink(pb, groupName)).toBeVisible();
  await expect(notificationList(pb)).toHaveText(/没有通知/);

  // 丙拒绝：邀请消失，侧边栏没有这个组
  const pc = await openAs(browser, c);
  await bell(pc).click();
  await notificationList(pc).getByRole('button', { name: '拒绝' }).click();
  await expect(notificationList(pc)).toHaveText(/没有通知/);
  await expect(groupSection(pc).getByRole('link')).toHaveCount(0);

  // 乙进组：看得到甲建的任务；乙建的任务甲也看得到；乙可以标记完成（合作组里人人都是 R 和 A）
  await groupLink(pb, groupName).click();
  await expect(taskItem(pb, `${id} 甲建的组任务`)).toBeVisible();
  await quickAdd(pb, `${id} 乙建的组任务`);
  await pb.getByRole('checkbox', { name: `完成：${id} 甲建的组任务` }).click();
  await expect(taskItem(pb, `${id} 甲建的组任务`)).toHaveCount(0);
  await pa.reload();
  await expect(taskItem(pa, `${id} 乙建的组任务`)).toBeVisible();
  await expect(taskItem(pa, `${id} 甲建的组任务`)).toHaveCount(0);
  await pa.locator('.status-bar').getByRole('button', { name: '已完成' }).click();
  await expect(taskItem(pa, `${id} 甲建的组任务`)).toBeVisible();

  // 昵称：每个组各自的名单；默认是 TaskApp 名字，自己的昵称点开原地编辑
  const panelB = await openGroupPanel(pb);
  const roster = panelB.getByRole('region', { name: '名单' });
  await expect(roster.getByRole('listitem')).toHaveText([`${id}甲`, `${id}乙`]);
  await roster.getByRole('button', { name: `我在本组的昵称：${id}乙` }).click();
  const nickname = roster.getByRole('textbox', { name: '我在本组的昵称' });
  await expect(nickname).toBeFocused();
  await nickname.fill('小乙');
  await nickname.press('Enter');
  await expect(roster.getByRole('button', { name: '我在本组的昵称：小乙' })).toBeVisible();
  await pa.reload();
  const rosterA = (await openGroupPanel(pa)).getByRole('region', { name: '名单' });
  await expect(rosterA.getByRole('listitem')).toHaveText([`${id}甲`, '小乙']);
  // 昵称只在这个组里：乙的 TaskApp 名字不变
  await expect(sidebar(pb).locator('.account-current')).toHaveText(`${id}乙`);
  // 清空 = 恢复成 TaskApp 名字
  await roster.getByRole('button', { name: '我在本组的昵称：小乙' }).click();
  await nickname.fill('');
  await nickname.press('Enter');
  await expect(roster.getByRole('button', { name: `我在本组的昵称：${id}乙` })).toBeVisible();

  // 非成员（拒绝了邀请的丙）什么都看不到：组、名单、任务都查不到；直接打开组的地址回到总览
  for (const path of [
    `groups?select=id&id=eq.${groupId}`,
    `group_members?select=user_id&group_id=eq.${groupId}`,
    `tasks?select=id&group_id=eq.${groupId}`,
  ]) {
    expect(await queryRest<unknown[]>(pc.request, path, c)).toEqual([]);
  }
  await pc.goto(`/?group=${groupId}`);
  await expect(titleBar(pc)).toHaveText('总览');
  await expect(pc).not.toHaveURL(/group=/);
  await expect(taskItem(pc, `${id} 甲建的组任务`)).toHaveCount(0);

  // 组任务不能改成收藏 / 带重要性（数据库层面也拦住）
  const [task] = await queryRest<{ id: string }[]>(
    pa.request,
    `tasks?select=id&title=eq.${id} 乙建的组任务`,
    a,
  );
  const patch = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/tasks?id=eq.${task!.id}`,
    {
      method: 'PATCH',
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${await accessTokenFor(a)}`,
        'Content-Profile': 'taskapp',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ is_starred: true }),
    },
  );
  expect(patch.ok).toBe(false);

  await Promise.all([pa, pb, pc].map((p) => p.context().close()));
});

test('在组里点分类：回到个人总览并选中这个分类；/matrix?group= 改成组的清单', async ({
  browser,
}) => {
  const id = runId();
  const a = await user('gcat', `${id}甲`);
  const groupId = await groupWith(a, [], `${id}组`);
  const page = await openAs(browser, a);
  // 建一个分类
  await sidebar(page).getByRole('button', { name: '+ 新建分类' }).click();
  const form = page.getByRole('form', { name: '新建分类' });
  await form.getByLabel('分类名称').fill(`${id}工作`);
  await form.getByRole('button', { name: '添加分类' }).click();
  await expect(sidebar(page).getByRole('button', { name: new RegExp(`^${id}工作`) })).toBeVisible();

  await groupLink(page, `${id}组`).click();
  await expect(titleBar(page)).toHaveText(`${id}组`);
  // 分类仍然显示（个人的），但不是选中状态
  const category = sidebar(page).getByRole('button', { name: new RegExp(`^${id}工作`) });
  await expect(category).toHaveAttribute('aria-pressed', 'false');
  await category.click();
  await expect(page).not.toHaveURL(/group=/);
  await expect(titleBar(page)).toHaveText(`${id}工作`);
  await expect(category).toHaveAttribute('aria-pressed', 'true');

  await page.goto(`/matrix?group=${groupId}`);
  await expect(page).toHaveURL(new RegExp(`/\\?group=${groupId}$`));
  await expect(titleBar(page)).toHaveText(`${id}组`);
  await page.context().close();
});

test('删除组：只有自己时直接删除；有其他组长时投票，一个不同意就取消，全部同意才删除', async ({
  browser,
}) => {
  const id = runId();
  const a = await user('gda', `${id}甲`);
  const b = await user('gdb', `${id}乙`);
  const c = await user('gdc', `${id}丙`);

  // 只有发起者一个人：直接删除，回到总览
  await groupWith(a, [], `${id}单人组`);
  const pa = await openAs(browser, a);
  await groupLink(pa, `${id}单人组`).click();
  await (await openGroupPanel(pa)).getByRole('button', { name: '删除组' }).click();
  await pa.getByRole('alertdialog').getByRole('button', { name: '删除' }).click();
  await expect(titleBar(pa)).toHaveText('总览');
  await expect(groupLink(pa, `${id}单人组`)).toHaveCount(0);

  // 三人组：甲发起（发起者算同意）
  const groupName = `${id}三人组`;
  const groupId = await groupWith(a, [b, c], groupName);
  await pa.reload();
  await groupLink(pa, groupName).click();
  await quickAdd(pa, `${id} 组里的任务`);
  await (await openGroupPanel(pa)).getByRole('button', { name: '删除组' }).click();
  await pa.getByRole('alertdialog').getByRole('button', { name: '删除' }).click();
  await expect(pa.locator('.group-panel').getByRole('status')).toHaveText('删除投票进行中');

  // 乙不同意：投票取消
  const pb = await openAs(browser, b);
  await expect(bell(pb)).toHaveAttribute('data-unread', 'true');
  await bell(pb).click();
  const vote = notificationList(pb).getByRole('listitem');
  await expect(vote).toHaveText(new RegExp(`${id}甲 发起删除「${groupName}」`));
  await vote.getByRole('button', { name: '不同意' }).click();
  await expect(notificationList(pb)).toHaveText(/没有通知/);
  const pc = await openAs(browser, c);
  await bell(pc).click();
  await expect(notificationList(pc)).toHaveText(/没有通知/);
  await pa.reload();
  await expect((await openGroupPanel(pa)).getByRole('button', { name: '删除组' })).toBeVisible();
  await expect(groupLink(pb, groupName)).toBeVisible();

  // 之后可以重新发起；乙、丙都同意才删除（组和组里的任务一起删掉）
  await pa.locator('.group-panel').getByRole('button', { name: '删除组' }).click();
  await pa.getByRole('alertdialog').getByRole('button', { name: '删除' }).click();
  await expect(pa.locator('.group-panel').getByRole('status')).toHaveText('删除投票进行中');
  await pb.reload();
  await bell(pb).click();
  await notificationList(pb).getByRole('button', { name: '同意', exact: true }).click();
  await expect(notificationList(pb)).toHaveText(/没有通知/);
  await expect(groupLink(pb, groupName)).toBeVisible();
  await pc.reload();
  await bell(pc).click();
  await notificationList(pc).getByRole('button', { name: '同意', exact: true }).click();
  await expect(groupLink(pc, groupName)).toHaveCount(0);

  await pa.reload();
  await expect(titleBar(pa)).toHaveText('总览');
  await expect(groupLink(pa, groupName)).toHaveCount(0);
  expect(
    await queryRest<unknown[]>(pa.request, `tasks?select=id&group_id=eq.${groupId}`, a),
  ).toEqual([]);

  await Promise.all([pa, pb, pc].map((p) => p.context().close()));
});

test('删除组：一周内没有操作的组长算作同意，任何成员打开 TaskApp 时检查（固定时钟）', async ({
  browser,
}) => {
  test.skip(!dbUrl(), '需要 E2E_DATABASE_URL 才能固定数据库时钟');
  const id = runId();
  const a = await user('gta', `${id}甲`);
  const b = await user('gtb', `${id}乙`);
  const groupName = `${id}超时组`;
  const groupId = await groupWith(a, [b], groupName);
  const start = new Date(Date.now() - 60_000);
  const at = (ms: number) => new Date(start.getTime() + ms);
  const DAY = 86_400_000;

  try {
    setDbClock(start);
    expect(await rpc(a, 'request_group_deletion', { p_group_id: groupId })).toBe('requested');

    // 差一分钟满一周：还在，乙看到投票通知
    setDbClock(at(7 * DAY - 60_000));
    const pb = await openAs(browser, b);
    await pb.clock.setFixedTime(at(7 * DAY - 60_000));
    await pb.reload();
    await expect(groupLink(pb, groupName)).toBeVisible();
    await bell(pb).click();
    await expect(notificationList(pb).getByRole('listitem')).toHaveText(
      new RegExp(`发起删除「${groupName}」`),
    );

    // 满一周：乙一直没操作算作同意，乙打开 TaskApp 时组被删除
    setDbClock(at(7 * DAY));
    await pb.clock.setFixedTime(at(7 * DAY));
    await pb.reload();
    await expect(sidebar(pb)).toBeVisible();
    await expect(groupLink(pb, groupName)).toHaveCount(0);
    expect(await queryRest<unknown[]>(pb.request, `groups?select=id&id=eq.${groupId}`, a)).toEqual(
      [],
    );
    await pb.context().close();
  } finally {
    setDbClock(null);
  }
});
