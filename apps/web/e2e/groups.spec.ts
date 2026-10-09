import { expect, test } from '@playwright/test';

import { accessTokenFor } from './auth';
import {
  bell,
  confirmDialog,
  editGroup,
  groupLink,
  groupSection,
  groupWith,
  notificationList,
  openAs,
  openRoster,
  projectIn,
  projectLink,
  rpc,
  sidebar,
  titleBar,
  user,
} from './group-helpers';
import { dbUrl, queryRest, quickAdd, runId, setDbClock, taskItem } from './helpers';

// 多个账号各用自己的浏览器上下文：从"没登录"开始
test.use({ storageState: { cookies: [], origins: [] } });

test('建组、建项目、邀请（接受 / 拒绝）、昵称；合作组里人人在每个项目里，非成员什么都看不到', async ({
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
  const createForm = groupSection(pa).getByRole('form', { name: '新建组' });
  await createForm.getByRole('textbox', { name: '组名' }).fill(groupName);
  // 默认是合作组
  await expect(createForm.getByRole('radio', { name: '合作组' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await createForm.getByRole('button', { name: '创建组' }).click();
  await expect(pa).toHaveURL(/\?group=/);
  await expect(titleBar(pa)).toHaveText(groupName);
  await expect(groupLink(pa, groupName)).toHaveAttribute('aria-current', 'page');
  const groupId = new URL(pa.url()).searchParams.get('group')!;

  // 组长在组下面建项目：名字、颜色、工具箱（都不选）、项目成员；建好后进入这个项目
  await groupSection(pa).getByRole('button', { name: '+ 新建项目' }).click();
  const projectForm = groupSection(pa).getByRole('form', { name: '新建项目' });
  await projectForm.getByRole('textbox', { name: '项目名' }).fill(`${id}项目一`);
  await projectForm.getByRole('button', { name: '创建项目' }).click();
  await expect(pa).toHaveURL(/&project=/);
  await expect(titleBar(pa)).toHaveText(`${id}项目一`);
  await expect(projectLink(pa, `${id}项目一`)).toHaveAttribute('aria-current', 'page');
  const projectId = new URL(pa.url()).searchParams.get('project')!;

  // 项目里：清单 / 矩阵切换照常在左上角；快速添加有重要性、没有收藏，展开后没有分类
  await expect(pa.getByRole('link', { name: '切换到矩阵' })).toHaveCount(1);
  const bar = pa.locator('.quick-add');
  await expect(bar.getByRole('group', { name: '重要性' })).toHaveCount(1);
  await bar.getByRole('button', { name: '展开完整选项' }).click();
  await expect(bar.getByRole('group', { name: '分类' })).toHaveCount(0);
  await expect(bar.getByRole('button', { name: '标星' })).toHaveCount(0);
  await expect(bar.getByRole('group', { name: '地点' })).toBeVisible();
  await expect(bar.getByRole('group', { name: '人物' })).toBeVisible();
  await bar.getByRole('button', { name: '收起' }).click();
  await quickAdd(pa, `${id} 甲建的组任务`);
  const row = taskItem(pa, `${id} 甲建的组任务`);
  await expect(row.getByRole('button', { name: '标星' })).toHaveCount(0);
  // 展开的面板里有重要性，没有分类、收藏
  await row.locator('.task-main').click();
  const panel = pa.getByRole('form', { name: '编辑任务' });
  await expect(panel.getByRole('group', { name: '地点' })).toBeVisible();
  await expect(panel.getByRole('group', { name: '重要性' })).toHaveCount(1);
  await expect(panel.getByRole('group', { name: '分类' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '标星' })).toHaveCount(0);
  await panel.getByRole('button', { name: '完成编辑' }).click();

  // 落库：任务记下所属的项目和组，重要性是默认的随意（0）、没有标星
  const [stored] = await queryRest<
    { group_id: string; project_id: string; importance_level: number; is_starred: boolean }[]
  >(
    pa.request,
    `tasks?select=group_id,project_id,importance_level,is_starred&title=eq.${id} 甲建的组任务`,
    a,
  );
  expect(stored).toEqual({
    group_id: groupId,
    project_id: projectId,
    importance_level: 0,
    is_starred: false,
  });

  // 组任务不出现在总览里
  await sidebar(pa).getByRole('link', { name: /总览/ }).click();
  await expect(titleBar(pa)).toHaveText('总览');
  await expect(pa.getByLabel('快速添加任务')).toBeVisible();
  await expect(taskItem(pa, `${id} 甲建的组任务`)).toHaveCount(0);
  await expect(pa.getByRole('link', { name: '切换到矩阵' })).toBeVisible();

  // 邀请：名单窗口上面输入邮箱（不发邮件）
  await groupLink(pa, groupName).click();
  const roster = await openRoster(pa);
  const invite = roster.getByRole('form', { name: '邀请' });
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
  await roster.getByRole('button', { name: '关闭' }).click();
  await expect(roster).toHaveCount(0);

  // 乙第一次登录 TaskApp：通知图标带小圆点，点开看到邀请，同意后组出现在侧边栏
  const pb = await openAs(browser, b);
  await expect(bell(pb)).toHaveAttribute('data-unread', 'true');
  await bell(pb).click();
  const invitation = notificationList(pb).getByRole('listitem');
  await expect(invitation).toHaveText(new RegExp(`${id}甲邀请你加入「${groupName}」`));
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

  // 乙进组：合作组里人人都是组长，自动在每个项目里；看得到甲建的任务，乙建的任务甲也看得到；
  // 没开任务分配：项目成员都能标记完成
  await groupLink(pb, groupName).click();
  await expect(projectLink(pb, `${id}项目一`)).toBeVisible();
  await expect(taskItem(pb, `${id} 甲建的组任务`)).toBeVisible();
  await projectLink(pb, `${id}项目一`).click();
  await quickAdd(pb, `${id} 乙建的组任务`);
  await pb.getByRole('checkbox', { name: `完成：${id} 甲建的组任务` }).click();
  await expect(taskItem(pb, `${id} 甲建的组任务`)).toHaveCount(0);
  await pa.reload();
  await expect(taskItem(pa, `${id} 乙建的组任务`)).toBeVisible();
  await expect(taskItem(pa, `${id} 甲建的组任务`)).toHaveCount(0);
  await pa.locator('.status-bar').getByRole('button', { name: '已完成' }).click();
  await expect(taskItem(pa, `${id} 甲建的组任务`)).toBeVisible();

  // 组名单窗口（组页面标题右边）：组里所有人（合作组人人都是组长，不显示身份）
  await groupLink(pb, groupName).click();
  await expect(titleBar(pb)).toHaveText(groupName);
  const rosterB = await openRoster(pb);
  await expect(rosterB.locator('.roster-name')).toHaveText([`${id}甲`, `${id}乙`]);
  await expect(rosterB.locator('.roster-role')).toHaveCount(0);
  await rosterB.getByRole('button', { name: '关闭' }).click();

  // 昵称：侧边栏组旁边的铅笔，每个人都能改自己在本组的昵称；默认是 TaskApp 名字
  let form = await editGroup(pb, groupName);
  // 合作组里人人都是组长：组名和颜色也能改
  await expect(form.getByRole('textbox', { name: '组名' })).toBeVisible();
  await form.getByLabel('我在本组的昵称').fill('小乙');
  await form.getByRole('button', { name: '保存' }).click();
  await expect(form).toHaveCount(0);
  await pa.reload();
  await expect((await openRoster(pa)).locator('.roster-name')).toHaveText([`${id}甲`, '小乙']);
  // 昵称只在这个组里：乙的 TaskApp 名字不变
  await expect(sidebar(pb).locator('.account-current')).toHaveText(`${id}乙`);
  // 清空 = 恢复成 TaskApp 名字
  form = await editGroup(pb, groupName);
  await expect(form.getByLabel('我在本组的昵称')).toHaveValue('小乙');
  await form.getByLabel('我在本组的昵称').fill('');
  await form.getByRole('button', { name: '保存' }).click();
  await expect(form).toHaveCount(0);
  await expect((await openRoster(pb)).locator('.roster-name')).toHaveText([`${id}甲`, `${id}乙`]);

  // 非成员（拒绝了邀请的丙）什么都看不到：组、名单、任务都查不到；直接打开组的地址回到总览
  for (const path of [
    `groups?select=id&id=eq.${groupId}`,
    `group_members?select=user_id&group_id=eq.${groupId}`,
    `tasks?select=id&group_id=eq.${groupId}`,
    `projects?select=id&group_id=eq.${groupId}`,
  ]) {
    expect(await queryRest<unknown[]>(pc.request, path, c)).toEqual([]);
  }
  await pc.goto(`/?group=${groupId}`);
  await expect(titleBar(pc)).toHaveText('总览');
  await expect(pc).not.toHaveURL(/group=/);
  await expect(taskItem(pc, `${id} 甲建的组任务`)).toHaveCount(0);

  // 组任务不能改成收藏（数据库层面也拦住）
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

test('在组里点分类：到这个分类的页面（单选导航，只高亮这一项）；从组页面进矩阵再回来，回到这个组', async ({
  browser,
}) => {
  const id = runId();
  const a = await user('gcat', `${id}甲`);
  const groupId = await groupWith(a, [], `${id}组`);
  await projectIn(a, groupId, `${id}项目`);
  const page = await openAs(browser, a);
  // 建一个分类
  await sidebar(page).getByRole('button', { name: '+ 新建分类' }).click();
  const form = page.getByRole('form', { name: '新建分类' });
  await form.getByLabel('分类名称', { exact: true }).fill(`${id}工作`);
  await form.getByRole('button', { name: '添加分类' }).click();
  const category = sidebar(page).getByRole('link', { name: new RegExp(`^${id}工作`) });
  await expect(category).toBeVisible();

  await groupLink(page, `${id}组`).click();
  await expect(titleBar(page)).toHaveText(`${id}组`);
  await expect(category).not.toHaveAttribute('aria-current', 'page');
  await category.click();
  await expect(page).not.toHaveURL(/group=/);
  await expect(titleBar(page)).toHaveText(`${id}工作`);
  await expect(category).toHaveAttribute('aria-current', 'page');
  await expect(groupLink(page, `${id}组`)).not.toHaveAttribute('aria-current', 'page');

  await groupLink(page, `${id}组`).click();
  await page.getByRole('link', { name: '切换到矩阵' }).click();
  await expect(page).toHaveURL(new RegExp(`/matrix\\?group=${groupId}$`));
  await page.getByRole('link', { name: '切换到清单' }).click();
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
  await (await editGroup(pa, `${id}单人组`)).getByRole('button', { name: '删除组' }).click();
  await confirmDialog(pa).getByRole('button', { name: '删除' }).click();
  await expect(titleBar(pa)).toHaveText('总览');
  await expect(groupLink(pa, `${id}单人组`)).toHaveCount(0);

  // 三人组：甲发起（发起者算同意）
  const groupName = `${id}三人组`;
  const groupId = await groupWith(a, [b, c], groupName);
  await projectIn(a, groupId, `${id}项目`);
  await pa.reload();
  await projectLink(pa, `${id}项目`).click();
  await quickAdd(pa, `${id} 组里的任务`);
  let form = await editGroup(pa, groupName);
  await form.getByRole('button', { name: '删除组' }).click();
  await confirmDialog(pa).getByRole('button', { name: '删除' }).click();
  await expect(form.getByRole('status')).toHaveText('删除投票进行中');
  await expect(form.getByRole('button', { name: '删除组' })).toHaveCount(0);

  // 乙不同意：投票取消
  const pb = await openAs(browser, b);
  await expect(bell(pb)).toHaveAttribute('data-unread', 'true');
  await bell(pb).click();
  const vote = notificationList(pb).getByRole('listitem');
  await expect(vote).toHaveText(new RegExp(`${id}甲发起删除「${groupName}」`));
  await vote.getByRole('button', { name: '不同意' }).click();
  await expect(notificationList(pb)).toHaveText(/没有通知/);
  const pc = await openAs(browser, c);
  await bell(pc).click();
  await expect(notificationList(pc)).toHaveText(/没有通知/);
  await pa.reload();
  form = await editGroup(pa, groupName);
  await expect(form.getByRole('button', { name: '删除组' })).toBeVisible();
  await expect(groupLink(pb, groupName)).toBeVisible();

  // 之后可以重新发起；乙、丙都同意才删除（组和组里的项目、任务一起删掉）
  await form.getByRole('button', { name: '删除组' }).click();
  await confirmDialog(pa).getByRole('button', { name: '删除' }).click();
  await expect(form.getByRole('status')).toHaveText('删除投票进行中');
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
    // 删除在打开页面时异步进行，等它完成
    await expect
      .poll(() => queryRest<unknown[]>(pb.request, `groups?select=id&id=eq.${groupId}`, a))
      .toEqual([]);
    await pb.context().close();
  } finally {
    setDbClock(null);
  }
});
