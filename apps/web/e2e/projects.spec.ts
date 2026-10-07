import { expect, test, type Page } from '@playwright/test';

import { accessTokenFor } from './auth';
import {
  bell,
  confirmDialog,
  groupLink,
  groupSection,
  groupTask,
  groupWith,
  notificationList,
  openAs,
  openRoster,
  projectIn,
  projectLink,
  rosterAction,
  rosterDialog,
  rosterRow,
  rpc,
  select,
  sidebar,
  titleBar,
  user,
  userId,
} from './group-helpers';
import { quickAdd, runId, taskItem } from './helpers';

// 多个账号各用自己的浏览器上下文：从"没登录"开始
test.use({ storageState: { cookies: [], origins: [] } });

/** 按这个账号的身份直接改表（RLS 和触发器决定能不能改） */
async function patch(u: Parameters<typeof accessTokenFor>[0], path: string, body: object) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${await accessTokenFor(u)}`,
      'Content-Profile': 'taskapp',
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  return { ok: response.ok, text: await response.text() };
}

const quickBar = (page: Page) => page.locator('.quick-add');

test('工具箱：项目建好后不能改；个人分类的工具箱只有"任务关系"，建分类时选，之后不能改', async ({
  browser,
}) => {
  const id = runId();
  const L = await user('tl', `${id}组长`);
  const groupId = await groupWith(L, [], `${id}组`, 'management');
  const projectId = await projectIn(L, groupId, `${id}项目`, ['assignment']);
  // 项目的工具箱：数据库不让改（也没有改的入口）
  expect((await patch(L, `projects?id=eq.${projectId}`, { tools: [] })).ok).toBe(false);
  expect(await select<{ tools: string[] }>(L, `projects?select=tools&id=eq.${projectId}`)).toEqual([
    { tools: ['assignment'] },
  ]);

  // 个人分类：建分类时选工具箱（只有任务关系）
  const page = await openAs(browser, L);
  await sidebar(page).getByRole('button', { name: '+ 新建分类' }).click();
  let form = page.getByRole('form', { name: '新建分类' });
  const toolbox = form.getByRole('group', { name: '工具箱' });
  await expect(toolbox.getByRole('checkbox')).toHaveCount(1);
  await toolbox.getByRole('checkbox', { name: '任务关系' }).check();
  await form.getByLabel('分类名称', { exact: true }).fill(`${id}有关系`);
  await form.getByRole('button', { name: '添加分类' }).click();
  await expect(form).toHaveCount(0);
  await sidebar(page).getByRole('button', { name: '+ 新建分类' }).click();
  form = page.getByRole('form', { name: '新建分类' });
  await form.getByLabel('分类名称', { exact: true }).fill(`${id}没工具`);
  await form.getByRole('button', { name: '添加分类' }).click();
  await expect(form).toHaveCount(0);
  const categories = await select<{ id: string; name: string; tools: string[] }>(
    L,
    `categories?select=id,name,tools&name=like.${id}*&order=name`,
  );
  expect(categories.map((c) => [c.name, c.tools])).toEqual([
    [`${id}有关系`, ['relations']],
    [`${id}没工具`, []],
  ]);

  // 编辑分类：工具箱只显示，不能改（数据库也拦住）
  await sidebar(page)
    .getByRole('button', { name: `编辑分类「${id}有关系」` })
    .click();
  const edit = page.getByRole('form', { name: `编辑分类「${id}有关系」` });
  const editBox = edit.getByRole('group', { name: '工具箱' }).getByRole('checkbox');
  await expect(editBox).toBeChecked();
  await expect(editBox).toBeDisabled();
  const withTools = categories.find((c) => c.name === `${id}有关系`)!;
  expect((await patch(L, `categories?id=eq.${withTools.id}`, { tools: [] })).text).toMatch(
    /分类的工具箱建好后不能改/,
  );
  // 分类的工具箱里没有任务分配
  expect(
    (await patch(L, `categories?id=eq.${withTools.id}`, { tools: ['relations', 'assignment'] })).ok,
  ).toBe(false);
  await page.context().close();
});

test('项目的任务只有项目成员看得到；用邮箱加人：组员直接加入，组外的人同意邀请后加入、只看得到自己的项目', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const id = runId();
  const L = await user('vl', `${id}组长`);
  const M = await user('vm', `${id}组员`);
  const O = await user('vo', `${id}外人`);
  const groupName = `${id}组`;
  const groupId = await groupWith(L, [M], groupName, 'management');
  const p1 = await projectIn(L, groupId, `${id}项目一`, [], [M]);
  const p2 = await projectIn(L, groupId, `${id}项目二`, [], []);
  await groupTask(L, p1, `${id} 一的任务`);
  await groupTask(L, p2, `${id} 二的任务`);

  // 组员只在项目一里：侧边栏只有项目一，组页面只有项目一的任务，查表也查不到项目二
  const pm = await openAs(browser, M);
  await groupLink(pm, groupName).click();
  await expect(groupSection(pm).locator('.sidebar-projects').getByRole('link')).toHaveText([
    new RegExp(`${id}项目一`),
  ]);
  await expect(taskItem(pm, `${id} 一的任务`)).toBeVisible();
  await expect(taskItem(pm, `${id} 二的任务`)).toHaveCount(0);
  expect(await select(M, `projects?select=id&id=eq.${p2}`)).toEqual([]);
  expect(await select(M, `tasks?select=id&project_id=eq.${p2}`)).toEqual([]);
  // 组长自动在每个项目里
  const pl = await openAs(browser, L);
  await groupLink(pl, groupName).click();
  await expect(taskItem(pl, `${id} 一的任务`)).toBeVisible();
  await expect(taskItem(pl, `${id} 二的任务`)).toBeVisible();

  // 项目二的名单窗口：用邮箱加人。组员直接加入，组外的人收到邀请
  await projectLink(pl, `${id}项目二`).click();
  await expect(titleBar(pl)).toHaveText(`${id}项目二`);
  const roster = await openRoster(pl);
  const invite = roster.getByRole('form', { name: '邀请' });
  await invite.getByRole('textbox', { name: '邀请的邮箱' }).fill(M.email);
  await invite.getByRole('button', { name: '邀请' }).click();
  await expect(invite.getByRole('status')).toHaveText(`已加入：${M.email}`);
  await expect(rosterRow(pl, `${id}组员`)).toBeVisible();
  await invite.getByRole('textbox', { name: '邀请的邮箱' }).fill(O.email);
  await invite.getByRole('button', { name: '邀请' }).click();
  await expect(invite.getByRole('status')).toHaveText(`已邀请：${O.email}`);
  await expect(rosterRow(pl, `${id}外人`)).toHaveCount(0);
  await roster.getByRole('button', { name: '关闭' }).click();
  await pm.reload();
  await expect(taskItem(pm, `${id} 二的任务`)).toBeVisible();

  // 组外的人：通知里"甲邀请你加入某组的某项目"，同意后加入
  const po = await openAs(browser, O);
  await bell(po).click();
  const item = notificationList(po).getByRole('listitem');
  await expect(item.locator('.notification-text')).toHaveText(
    `${id}组长邀请你加入「${groupName}」的「${id}项目二」`,
  );
  await item.getByRole('button', { name: '同意', exact: true }).click();
  await expect(notificationList(po)).toHaveText(/没有通知/);
  // 侧边栏：组名下面只有自己的项目
  await expect(groupLink(po, groupName)).toBeVisible();
  await expect(groupSection(po).locator('.sidebar-projects').getByRole('link')).toHaveText([
    new RegExp(`${id}项目二`),
  ]);
  // 组页面：标题是组名，没有组名单按钮，也没有编辑组的铅笔；只有自己项目的任务
  await groupLink(po, groupName).click();
  await expect(titleBar(po)).toHaveText(groupName);
  await expect(po.locator('.title-row').getByRole('button', { name: '名单' })).toHaveCount(0);
  await expect(groupSection(po).getByRole('button', { name: /^编辑组/ })).toHaveCount(0);
  await expect(taskItem(po, `${id} 二的任务`)).toBeVisible();
  await expect(taskItem(po, `${id} 一的任务`)).toHaveCount(0);
  // 看不到组名单
  expect(await rpc(O, 'group_roster', { p_group_id: groupId })).toEqual([]);
  expect(await select(O, `group_members?select=user_id&group_id=eq.${groupId}`)).toEqual([]);
  // 项目页面有项目名单（管理组里只在项目里的人是组员）
  await projectLink(po, `${id}项目二`).click();
  await openRoster(po);
  await expect(rosterRow(po, `${id}外人`).locator('.roster-role')).toHaveText('组员');
  await rosterDialog(po).getByRole('button', { name: '关闭' }).click();
  // 项目没开任务分配：项目成员都能标记完成，完成即确认
  await po.getByRole('checkbox', { name: `完成：${id} 二的任务` }).click();
  await expect(taskItem(po, `${id} 二的任务`)).toHaveCount(0);
  const [done] = await select<{ completed_at: string | null; confirmed_at: string | null }>(
    O,
    `tasks?select=completed_at,confirmed_at&title=eq.${id} 二的任务`,
  );
  expect(done!.completed_at).not.toBeNull();
  expect(done!.confirmed_at).toBe(done!.completed_at);
  // 没开任务分配：没有任务通知
  expect(
    (await rpc<{ kind: string }[]>(L, 'my_notifications')).filter((n) => n.kind === 'task'),
  ).toEqual([]);

  // 退出项目后：组也从侧边栏消失
  expect(await rpc(O, 'leave_project', { p_project_id: p2 })).toBe('left');
  await po.reload();
  await expect(groupLink(po, groupName)).toHaveCount(0);

  await Promise.all([pl, pm, po].map((p) => p.context().close()));
});

test('项目管理员只在被任命的项目里有权限；组长在每个项目里、不能被移出也不能退出；合作组里只在项目里的人是管理员', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const id = runId();
  const L = await user('al', `${id}组长`);
  const A = await user('aa', `${id}管理`);
  const groupId = await groupWith(L, [A], `${id}组`, 'management');
  const p1 = await projectIn(L, groupId, `${id}管理的项目`, ['assignment']);
  const p2 = await projectIn(L, groupId, `${id}别的项目`, ['assignment']);
  await rpc(L, 'set_project_member_role', {
    p_project_id: p1,
    p_user_id: await userId(A),
    p_role: 'admin',
  });

  const pa = await openAs(browser, A);
  await projectLink(pa, `${id}管理的项目`).click();
  await expect(pa.getByLabel('快速添加任务')).toBeEnabled();
  await projectLink(pa, `${id}别的项目`).click();
  await expect(pa.getByLabel('快速添加任务')).toBeDisabled();
  await openRoster(pa);
  await expect(rosterDialog(pa).getByRole('form')).toHaveCount(0);
  await rosterDialog(pa).getByRole('button', { name: '关闭' }).click();
  // 数据库同样拦住
  const raci = [
    { role: 'R' as const, userId: await userId(A) },
    { role: 'A' as const, userId: await userId(A) },
  ];
  await expect(groupTask(A, p1, `${id} 能建`, raci)).resolves.toBeTruthy();
  await expect(groupTask(A, p2, `${id} 不能建`, raci)).rejects.toThrow(/只有项目管理员可以建任务/);
  await expect(rpc(A, 'add_project_contact', { p_project_id: p2, p_name: 'x' })).rejects.toThrow(
    /没有添加的权限/,
  );
  // 管理员不能任命管理员（只有组长）
  await expect(
    rpc(A, 'set_project_member_role', {
      p_project_id: p1,
      p_user_id: await userId(A),
      p_role: 'member',
    }),
  ).rejects.toThrow(/只有组长可以任命或撤销项目管理员/);

  // 组长：建项目时没选任何成员也在项目里；不能被移出，也不能退出项目
  const p3 = await projectIn(L, groupId, `${id}空项目`, [], []);
  const roster = await rpc<{ nickname: string; role: string }[]>(L, 'project_roster', {
    p_project_id: p3,
  });
  expect(roster.map((r) => [r.nickname, r.role])).toEqual([[`${id}组长`, 'leader']]);
  await expect(
    rpc(A, 'remove_project_member', { p_project_id: p1, p_user_id: await userId(L) }),
  ).rejects.toThrow(/没有把这个人移出项目的权限/);
  await expect(rpc(L, 'leave_project', { p_project_id: p1 })).rejects.toThrow(/组长不能退出项目/);

  // 合作组：人人都是组长；只在项目里的人在项目里是管理员（能建任务、设 RACI）
  const C = await user('ac', `${id}合作外人`);
  await rpc(C, 'ensure_current_user', { p_email: C.email, p_display_name: C.name });
  const coopId = await groupWith(L, [], `${id}合作组`);
  const cp = await projectIn(L, coopId, `${id}合作项目`, ['assignment']);
  expect(await rpc(L, 'invite_to_project', { p_project_id: cp, p_email: C.email })).toBe('invited');
  const [invitation] = await select<{ id: string }>(
    C,
    `project_invitations?select=id&project_id=eq.${cp}`,
  );
  await rpc(C, 'accept_project_invitation', { p_invitation_id: invitation!.id });
  const coopRoster = await rpc<{ nickname: string; role: string }[]>(C, 'project_roster', {
    p_project_id: cp,
  });
  expect(coopRoster.map((r) => [r.nickname, r.role])).toEqual([
    [`${id}组长`, 'leader'],
    [`${id}合作外人`, 'admin'],
  ]);
  const pc = await openAs(browser, C);
  await projectLink(pc, `${id}合作项目`).click();
  await expect(pc.getByLabel('快速添加任务')).toBeEnabled();
  await expect(quickBar(pc).getByRole('combobox', { name: '执行人（R）' })).toBeVisible();

  await Promise.all([pa, pc].map((p) => p.context().close()));
});

test('移出项目：开了任务分配、身上有 R 或 A 时失败并列出 RACI；否则确认窗口列出 C、I；没开任务分配直接确认', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const id = runId();
  const L = await user('rl', `${id}组长`);
  const M = await user('rm', `${id}执行`);
  const N = await user('rn', `${id}知会`);
  const groupId = await groupWith(L, [M, N], `${id}组`, 'management');
  const p1 = await projectIn(L, groupId, `${id}分配项目`, ['assignment']);
  const p2 = await projectIn(L, groupId, `${id}普通项目`);
  const title = `${id} 任务`;
  await groupTask(L, p1, title, [
    { role: 'R', userId: await userId(M) },
    { role: 'A', userId: await userId(L) },
    { role: 'I', userId: await userId(N) },
  ]);

  const pl = await openAs(browser, L);
  await projectLink(pl, `${id}分配项目`).click();
  await openRoster(pl);
  // 身上有 R：不能移出，列出他在这个项目里的 RACI
  await rosterAction(pl, `${id}执行`, '移出项目');
  await expect(confirmDialog(pl)).toHaveAccessibleName(`不能移出「${id}执行」`);
  await expect(confirmDialog(pl).locator('.raci-roles-list li')).toHaveText([`${title}R`]);
  await confirmDialog(pl).getByRole('button', { name: '关闭' }).click();
  await expect(rosterRow(pl, `${id}执行`)).toBeVisible();
  // 只有 I：确认窗口列出 I，确认后移出，I 一并去掉；他还在组里
  await rosterAction(pl, `${id}知会`, '移出项目');
  await expect(confirmDialog(pl)).toHaveAccessibleName(`把「${id}知会」移出项目？`);
  await expect(confirmDialog(pl).locator('.raci-roles-list li')).toHaveText([`${title}I`]);
  await confirmDialog(pl).getByRole('button', { name: '移出' }).click();
  await expect(rosterRow(pl, `${id}知会`)).toHaveCount(0);
  expect(await select(L, `task_assignments?select=role&user_id=eq.${await userId(N)}`)).toEqual([]);
  expect(await select(N, `projects?select=id&id=eq.${p1}`)).toEqual([]);
  expect(await select(N, `groups?select=id&id=eq.${groupId}`)).toHaveLength(1);
  await rosterDialog(pl).getByRole('button', { name: '关闭' }).click();

  // 执行人自己退出项目：同样不行
  expect(await rpc(M, 'leave_project', { p_project_id: p1 })).toBe('blocked');

  // 没开任务分配的项目：直接确认，确认后移出
  await projectLink(pl, `${id}普通项目`).click();
  await openRoster(pl);
  await rosterAction(pl, `${id}执行`, '移出项目');
  await expect(confirmDialog(pl)).toHaveAccessibleName(`把「${id}执行」移出项目？`);
  await expect(confirmDialog(pl).locator('.raci-roles-list')).toHaveCount(0);
  await confirmDialog(pl).getByRole('button', { name: '移出' }).click();
  await expect(rosterRow(pl, `${id}执行`)).toHaveCount(0);
  expect(await select(M, `projects?select=id&id=eq.${p2}`)).toEqual([]);

  await pl.context().close();
});

test('删除项目：全体组长投票，发起者算同意；一个不同意就取消，全部同意才删除（连同项目里的任务）；只有一位组长时直接删除', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const id = runId();
  const L = await user('dl', `${id}甲`);
  const B = await user('db', `${id}乙`);
  const groupName = `${id}合作组`;
  // 合作组：两个人都是组长
  const groupId = await groupWith(L, [B], groupName);
  const projectName = `${id}项目`;
  const projectId = await projectIn(L, groupId, projectName);
  await groupTask(L, projectId, `${id} 项目里的任务`);

  const pl = await openAs(browser, L);
  const openEdit = async () => {
    await groupSection(pl)
      .getByRole('button', { name: `编辑项目「${projectName}」` })
      .click();
    return groupSection(pl).getByRole('form', { name: `编辑项目「${projectName}」` });
  };
  let form = await openEdit();
  await form.getByRole('button', { name: '删除项目' }).click();
  await expect(confirmDialog(pl)).toHaveAccessibleName(`删除「${projectName}」？`);
  await confirmDialog(pl).getByRole('button', { name: '删除' }).click();
  await expect(form.getByRole('status')).toHaveText('删除投票进行中');
  await expect(form.getByRole('button', { name: '删除项目' })).toHaveCount(0);

  // 乙不同意：投票取消
  const pb = await openAs(browser, B);
  await bell(pb).click();
  const vote = notificationList(pb).getByRole('listitem');
  await expect(vote.locator('.notification-text')).toHaveText(
    `${id}甲发起删除「${groupName}」的「${projectName}」`,
  );
  await vote.getByRole('button', { name: '不同意' }).click();
  await expect(notificationList(pb)).toHaveText(/没有通知/);
  await pl.reload();
  form = await openEdit();
  await expect(form.getByRole('button', { name: '删除项目' })).toBeVisible();

  // 重新发起，乙同意：项目和项目里的任务一起删除
  await form.getByRole('button', { name: '删除项目' }).click();
  await confirmDialog(pl).getByRole('button', { name: '删除' }).click();
  await expect(form.getByRole('status')).toHaveText('删除投票进行中');
  await pb.reload();
  await bell(pb).click();
  await notificationList(pb).getByRole('button', { name: '同意', exact: true }).click();
  await expect(projectLink(pb, projectName)).toHaveCount(0);
  await expect(groupLink(pb, groupName)).toBeVisible();
  expect(await select(L, `projects?select=id&id=eq.${projectId}`)).toEqual([]);
  expect(await select(L, `tasks?select=id&title=eq.${id} 项目里的任务`)).toEqual([]);

  // 只有一位组长（管理组）：直接删除；组员不能删除项目
  const M = await user('dm', `${id}组员`);
  const soloId = await groupWith(L, [M], `${id}管理组`, 'management');
  const solo = await projectIn(L, soloId, `${id}单人项目`);
  await expect(rpc(M, 'request_project_deletion', { p_project_id: solo })).rejects.toThrow(
    /只有组长可以删除项目/,
  );
  expect(await rpc(L, 'request_project_deletion', { p_project_id: solo })).toBe('deleted');

  await Promise.all([pl, pb].map((p) => p.context().close()));
});

test('组页面的快速添加：先选项目（只列出我能建任务的项目）；选了开了任务分配的项目才有执行人和负责人', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const id = runId();
  const L = await user('ql', `${id}组长`);
  const A = await user('qa', `${id}管理`);
  const M = await user('qm', `${id}组员`);
  const groupName = `${id}组`;
  const groupId = await groupWith(L, [A, M], groupName, 'management');
  const assign = await projectIn(L, groupId, `${id}分配`, ['assignment']);
  await projectIn(L, groupId, `${id}旁观`);
  const plain = await projectIn(L, groupId, `${id}普通`);
  for (const p of [assign, plain]) {
    await rpc(L, 'set_project_member_role', {
      p_project_id: p,
      p_user_id: await userId(A),
      p_role: 'admin',
    });
  }

  const pa = await openAs(browser, A);
  await groupLink(pa, groupName).click();
  const bar = quickBar(pa);
  const picker = bar.getByRole('combobox', { name: '项目', exact: true });
  await expect(picker.getByRole('option')).toHaveText(['项目', `${id}分配`, `${id}普通`]);
  // 没选项目时不能创建
  await pa.getByLabel('快速添加任务').fill(`${id} 普通任务`);
  await expect(bar.getByRole('button', { name: '创建', exact: true })).toBeDisabled();
  await expect(bar.getByRole('combobox', { name: '执行人（R）' })).toHaveCount(0);
  await picker.selectOption({ label: `${id}普通` });
  await expect(bar.getByRole('combobox', { name: '执行人（R）' })).toHaveCount(0);
  await bar.getByRole('button', { name: '创建', exact: true }).click();
  await expect(taskItem(pa, `${id} 普通任务`)).toBeVisible();
  expect(
    await select<{ project_id: string }>(A, `tasks?select=project_id&title=eq.${id} 普通任务`),
  ).toEqual([{ project_id: plain }]);

  // 选开了任务分配的项目：出现执行人和负责人（负责人默认是自己），选了执行人才能创建
  await picker.selectOption({ label: `${id}分配` });
  await pa.getByLabel('快速添加任务').fill(`${id} 分配任务`);
  const quickR = bar.getByRole('combobox', { name: '执行人（R）' });
  await expect(bar.getByRole('combobox', { name: '负责人（A）' })).toHaveValue(await userId(A));
  await expect(bar.getByRole('button', { name: '创建', exact: true })).toBeDisabled();
  await quickR.selectOption({ label: `${id}组员` });
  await bar.getByRole('button', { name: '创建', exact: true }).click();
  await expect(taskItem(pa, `${id} 分配任务`).locator('.task-raci')).toHaveText([
    `R${id}组员`,
    `A${id}管理`,
  ]);
  const [created] = await select<{ id: string; project_id: string }>(
    A,
    `tasks?select=id,project_id&title=eq.${id} 分配任务`,
  );
  expect(created!.project_id).toBe(assign);

  // 在项目页面：默认就是这个项目，没有项目选择
  await projectLink(pa, `${id}普通`).click();
  await expect(bar.getByRole('combobox', { name: '项目', exact: true })).toHaveCount(0);
  await quickAdd(pa, `${id} 项目页面建的`);
  expect(
    await select<{ project_id: string }>(A, `tasks?select=project_id&title=eq.${id} 项目页面建的`),
  ).toEqual([{ project_id: plain }]);

  // 组员（不是任何项目的管理员）：组页面的添加栏在原位但不能用
  const pm = await openAs(browser, M);
  await groupLink(pm, groupName).click();
  await expect(pm.getByLabel('快速添加任务')).toBeDisabled();

  await Promise.all([pa, pm].map((p) => p.context().close()));
});
