import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  bell,
  confirmDialog,
  editGroup,
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
  type GroupUser,
} from './group-helpers';
import {
  dbUrl,
  editPanel,
  localDate,
  runId,
  selectStatus,
  setDbClock,
  taskItem,
  titleBox,
} from './helpers';

// 多个账号各用自己的浏览器上下文：从"没登录"开始
test.use({ storageState: { cookies: [], origins: [] } });

const roleOf = (page: Page, name: string) => rosterRow(page, name).locator('.roster-role');

/**
 * 准备一个管理组：组长 L、组员 A、M（以及更多组员）；组里一个开了任务分配的项目（所有人都在），
 * A 是这个项目的管理员
 */
async function managementGroup(id: string, extra: string[] = []) {
  const L = await user('ml', `${id}组长`);
  const A = await user('ma', `${id}管理`);
  const M = await user('mm', `${id}组员`);
  const others: GroupUser[] = [];
  for (const [i, name] of extra.entries()) others.push(await user(`mx${i}`, name));
  const groupName = `${id}管理组`;
  const groupId = await groupWith(L, [A, M, ...others], groupName, 'management');
  const projectName = `${id}项目`;
  const projectId = await projectIn(L, groupId, projectName, ['assignment']);
  await rpc(L, 'set_project_member_role', {
    p_project_id: projectId,
    p_user_id: await userId(A),
    p_role: 'admin',
  });
  return { L, A, M, others, groupId, groupName, projectId, projectName };
}

async function openNotifications(page: Page): Promise<Locator> {
  const list = notificationList(page);
  if ((await list.count()) === 0) await bell(page).click();
  await expect(list).toBeVisible();
  return list;
}

const notificationText = (page: Page, text: string | RegExp) =>
  notification(page, text).locator('.notification-text');
const notification = (page: Page, text: string | RegExp) =>
  notificationList(page).getByRole('listitem').filter({ hasText: text });

test('建管理组；组长 / 组员；建项目（工具箱多选、成员默认全选）；项目管理员只在被任命的项目里；按身份显示可用的操作', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const id = runId();
  const L = await user('nl', `${id}组长`);
  const A = await user('na', `${id}管理`);
  const M = await user('nm', `${id}组员`);
  const groupName = `${id}管理组`;
  const projectName = `${id}项目`;

  // 组长：建组时选管理组，选颜色
  const pl = await openAs(browser, L);
  await groupSection(pl).getByRole('button', { name: '+ 新建组' }).click();
  const create = groupSection(pl).getByRole('form', { name: '新建组' });
  await create.getByRole('textbox', { name: '组名' }).fill(groupName);
  await expect(create.getByRole('radiogroup', { name: '组的类型' }).getByRole('radio')).toHaveText([
    '合作组',
    '管理组',
  ]);
  await create.getByRole('radio', { name: '管理组' }).click();
  await create.getByRole('radio', { name: '#FF9500' }).click();
  await create.getByRole('button', { name: '创建组' }).click();
  await expect(titleBar(pl)).toHaveText(groupName);
  // 组的颜色显示在侧边栏组名前
  await expect(groupLink(pl, groupName).locator('.category-dot')).toHaveCSS(
    'background-color',
    'rgb(255, 149, 0)',
  );
  const groupId = new URL(pl.url()).searchParams.get('group')!;
  expect(
    await select<{ kind: string; color: string }>(L, `groups?select=kind,color&id=eq.${groupId}`),
  ).toEqual([{ kind: 'management', color: '#FF9500' }]);

  // 组名单窗口：邀请两个人；他们同意后是组员
  let roster = await openRoster(pl);
  for (const u of [A, M]) {
    await roster.getByRole('textbox', { name: '邀请的邮箱' }).fill(u.email);
    await roster.getByRole('button', { name: '邀请', exact: true }).click();
    await expect(roster.getByRole('form', { name: '邀请' }).getByRole('status')).toHaveText(
      `已邀请：${u.email}`,
    );
  }
  await roster.getByRole('button', { name: '关闭' }).click();
  const pa = await openAs(browser, A);
  const pm = await openAs(browser, M);
  for (const page of [pa, pm]) {
    await (
      await openNotifications(page)
    )
      .getByRole('button', { name: '同意', exact: true })
      .click();
    await expect(groupLink(page, groupName)).toBeVisible();
  }
  roster = await openRoster(pl);
  await expect(roster.locator('.roster-name')).toHaveText([`${id}组长`, `${id}管理`, `${id}组员`]);
  await expect(roster.locator('.roster-role')).toHaveText(['组长', '组员', '组员']);
  // 名单里有邮箱（参照 Google 的共享窗口）
  await expect(rosterRow(pl, `${id}管理`)).toContainText(A.email);
  // 组名单里组长对组员：任命组长、踢出（管理员是项目上的身份，不在组名单里）
  await rosterRow(pl, `${id}组员`)
    .getByRole('button', { name: `「${id}组员」的操作` })
    .click();
  await expect(rosterRow(pl, `${id}组员`).locator('.roster-actions button')).toHaveText([
    '任命为组长',
    '踢出',
  ]);
  await roster.getByRole('button', { name: '关闭' }).click();

  // 组员看不到"新建项目"；组长建项目：工具箱多选，项目成员从组里所有人里选、默认全选，组长不能去掉
  await pm.reload();
  await expect(groupSection(pm).getByRole('button', { name: '+ 新建项目' })).toHaveCount(0);
  await groupSection(pl).getByRole('button', { name: '+ 新建项目' }).click();
  const projectForm = groupSection(pl).getByRole('form', { name: '新建项目' });
  await projectForm.getByRole('textbox', { name: '项目名' }).fill(projectName);
  const toolbox = projectForm.getByRole('group', { name: '工具箱' });
  await expect(toolbox.getByRole('checkbox')).toHaveCount(2);
  await toolbox.getByRole('checkbox', { name: '任务分配' }).check();
  await toolbox.getByRole('checkbox', { name: '任务关系' }).check();
  const members = projectForm.getByRole('group', { name: '项目成员' });
  await expect(members.locator('.form-check')).toHaveText([`${id}组长`, `${id}管理`, `${id}组员`]);
  for (const name of [`${id}组长`, `${id}管理`, `${id}组员`]) {
    await expect(members.getByRole('checkbox', { name })).toBeChecked();
  }
  await expect(members.getByRole('checkbox', { name: `${id}组长` })).toBeDisabled();
  await projectForm.getByRole('button', { name: '创建项目' }).click();
  await expect(titleBar(pl)).toHaveText(projectName);
  const projectId = new URL(pl.url()).searchParams.get('project')!;
  expect(await select<{ tools: string[] }>(L, `projects?select=tools&id=eq.${projectId}`)).toEqual([
    { tools: ['assignment', 'relations'] },
  ]);

  // 项目名单：组长自动在项目里，不能被移出，也没有"退出项目"；组长任命管理员（先确认）
  roster = await openRoster(pl);
  await expect(roster.locator('.roster-name')).toHaveText([`${id}组长`, `${id}管理`, `${id}组员`]);
  await expect(roster.locator('.roster-role')).toHaveText(['组长', '组员', '组员']);
  await expect(
    rosterRow(pl, `${id}组长`).getByRole('button', { name: `「${id}组长」的操作` }),
  ).toHaveCount(0);
  await rosterAction(pl, `${id}管理`, '任命为管理员');
  await expect(confirmDialog(pl)).toHaveAccessibleName(`任命「${id}管理」为管理员？`);
  await confirmDialog(pl).getByRole('button', { name: '取消' }).click();
  await expect(roleOf(pl, `${id}管理`)).toHaveText('组员');
  await rosterAction(pl, `${id}管理`, '任命为管理员');
  await confirmDialog(pl).getByRole('button', { name: '任命' }).click();
  await expect(roleOf(pl, `${id}管理`)).toHaveText('管理员');
  // 撤销管理员（同样先确认），再任命回来
  await rosterAction(pl, `${id}管理`, '撤销管理员');
  await confirmDialog(pl).getByRole('button', { name: '撤销' }).click();
  await expect(roleOf(pl, `${id}管理`)).toHaveText('组员');
  await rosterAction(pl, `${id}管理`, '任命为管理员');
  await confirmDialog(pl).getByRole('button', { name: '任命' }).click();
  await expect(roleOf(pl, `${id}管理`)).toHaveText('管理员');
  // 组长对组员：任命管理员、移出项目
  await rosterRow(pl, `${id}组员`)
    .getByRole('button', { name: `「${id}组员」的操作` })
    .click();
  await expect(rosterRow(pl, `${id}组员`).locator('.roster-actions button')).toHaveText([
    '任命为管理员',
    '移出项目',
  ]);
  await roster.getByRole('button', { name: '关闭' }).click();

  // 管理员（这个项目）：能往项目里加人、添加只有名字的人；对组员只有"移出项目"，对组长没有操作；能建任务
  await pa.reload();
  await projectLink(pa, projectName).click();
  roster = await openRoster(pa);
  await expect(roster.getByRole('form', { name: '邀请' })).toBeVisible();
  await roster.getByRole('textbox', { name: '名字' }).fill(`${id}顾问`);
  await roster.getByRole('button', { name: '添加', exact: true }).click();
  await expect(rosterDialog(pa).locator('.roster-contact .roster-name')).toHaveText([`${id}顾问`]);
  await expect(
    rosterRow(pa, `${id}组长`).getByRole('button', { name: `「${id}组长」的操作` }),
  ).toHaveCount(0);
  await rosterRow(pa, `${id}组员`)
    .getByRole('button', { name: `「${id}组员」的操作` })
    .click();
  await expect(rosterRow(pa, `${id}组员`).locator('.roster-actions button')).toHaveText([
    '移出项目',
  ]);
  await roster.getByRole('button', { name: '关闭' }).click();
  await expect(pa.getByLabel('快速添加任务')).toBeEnabled();
  // 管理员在组里只是组员：组名单里没有邀请，看不到"新建项目"
  await groupLink(pa, groupName).click();
  roster = await openRoster(pa);
  await expect(roster.getByRole('form', { name: '邀请' })).toHaveCount(0);
  await roster.getByRole('button', { name: '关闭' }).click();
  await expect(groupSection(pa).getByRole('button', { name: '+ 新建项目' })).toHaveCount(0);

  // 组员：项目名单里没有加人、没有添加；只能对自己"退出项目"；添加栏在原位但不能用
  await pm.reload();
  await projectLink(pm, projectName).click();
  roster = await openRoster(pm);
  await expect(roster.getByRole('form', { name: '邀请' })).toHaveCount(0);
  await expect(roster.getByRole('form', { name: '添加只有名字的人' })).toHaveCount(0);
  await expect(rosterDialog(pm).getByRole('button', { name: /的操作$/ })).toHaveCount(1);
  await expect(rosterDialog(pm).getByRole('button', { name: /删除「/ })).toHaveCount(0);
  await roster.getByRole('button', { name: '关闭' }).click();
  await expect(pm.getByLabel('快速添加任务')).toBeDisabled();
  // 组员没有编辑项目的铅笔
  await expect(groupSection(pm).getByRole('button', { name: /^编辑项目/ })).toHaveCount(0);

  // 侧边栏的编辑表单：组长能改组名和颜色、能删除组；其他人只能改自己的昵称
  const formM = await editGroup(pm, groupName);
  await expect(formM.getByRole('textbox', { name: '组名' })).toHaveCount(0);
  await expect(formM.getByRole('radiogroup', { name: '组的颜色' })).toHaveCount(0);
  await expect(formM.getByRole('button', { name: '删除组' })).toHaveCount(0);
  await formM.getByLabel('我在本组的昵称').fill(`${id}小组员`);
  await formM.getByRole('button', { name: '保存' }).click();
  await expect(formM).toHaveCount(0);
  await groupLink(pl, groupName).click();
  const formL = await editGroup(pl, groupName);
  await expect(formL.getByRole('button', { name: '删除组' })).toBeVisible();
  await formL.getByRole('textbox', { name: '组名' }).fill(`${groupName}改`);
  await formL.getByRole('radio', { name: '#34C759' }).click();
  await formL.getByRole('button', { name: '保存' }).click();
  await expect(titleBar(pl)).toHaveText(`${groupName}改`);
  await expect(groupLink(pl, `${groupName}改`).locator('.category-dot')).toHaveCSS(
    'background-color',
    'rgb(52, 199, 89)',
  );
  roster = await openRoster(pl);
  await expect(rosterRow(pl, `${id}小组员`)).toBeVisible();
  await roster.getByRole('button', { name: '关闭' }).click();

  // 编辑项目（组长）：改名字和颜色；工具箱只显示，不能改
  await groupSection(pl)
    .getByRole('button', { name: `编辑项目「${projectName}」` })
    .click();
  const editForm = groupSection(pl).getByRole('form', { name: `编辑项目「${projectName}」` });
  const editTools = editForm.getByRole('group', { name: '工具箱' });
  await expect(editTools.getByRole('checkbox', { name: '任务分配' })).toBeChecked();
  await expect(editTools.getByRole('checkbox', { name: '任务分配' })).toBeDisabled();
  await editForm.getByRole('textbox', { name: '项目名' }).fill(`${projectName}改`);
  await editForm.getByRole('radio', { name: '#AF52DE' }).click();
  await editForm.getByRole('button', { name: '保存' }).click();
  await expect(projectLink(pl, `${projectName}改`).locator('.category-dot')).toHaveCSS(
    'background-color',
    'rgb(175, 82, 222)',
  );
  await expect(
    rpc(A, 'update_project', { p_project_id: projectId, p_name: 'y', p_color: null }),
  ).rejects.toThrow(/只有组长可以修改项目/);

  // 数据库同样拦住：组员不能建任务；只有组长能邀请人进组、建项目
  await expect(groupTask(M, projectId, 'x')).rejects.toThrow(/403/);
  for (const u of [A, M]) {
    await expect(
      rpc(u, 'invite_to_group', { p_group_id: groupId, p_email: 'x@example.com' }),
    ).rejects.toThrow(/只有组长可以邀请人进小组/);
    await expect(
      rpc(u, 'create_project', {
        p_group_id: groupId,
        p_name: 'x',
        p_color: null,
        p_tools: [],
        p_member_ids: [],
      }),
    ).rejects.toThrow(/只有组长可以建项目/);
  }

  await Promise.all([pl, pa, pm].map((p) => p.context().close()));
});

test('RACI：创建时设定（创建人默认是 A）；R 标记完成进入待确认、截止过了也不算已错过；A 确认 / 不通过；各类通知；责任分配矩阵', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const id = runId();
  const { L, A, M, groupId, projectId, projectName } = await managementGroup(id);
  const contact = await rpc<{ id: string }>(A, 'add_project_contact', {
    p_project_id: projectId,
    p_name: `${id}顾问`,
  });
  const title = `${id} 写发布说明`;

  // 管理员建任务：快速添加栏在时间旁边选执行人和负责人；负责人默认是自己，执行人没选时不能创建
  const pa = await openAs(browser, A);
  await projectLink(pa, projectName).click();
  const bar = pa.locator('.quick-add');
  await pa.getByLabel('快速添加任务').fill(title);
  const quickR = bar.getByRole('combobox', { name: '执行人（R）' });
  const quickA = bar.getByRole('combobox', { name: '负责人（A）' });
  await expect(quickA).toHaveValue(await userId(A));
  await expect(quickR).toHaveValue('');
  await expect(bar.getByRole('button', { name: '创建', exact: true })).toBeDisabled();
  await pa.getByLabel('快速添加任务').press('Enter');
  await expect(pa.getByLabel('快速添加任务')).toHaveValue(title);
  await quickR.selectOption({ label: `${id}组员` });
  await expect(bar.getByRole('button', { name: '创建', exact: true })).toBeEnabled();
  // 展开后四个角色写全称；R、A 只能选项目成员，C、I 还可以选只有名字的人
  await bar.getByRole('button', { name: '展开完整选项' }).click();
  const raci = bar.getByRole('group', { name: 'RACI' });
  await expect(raci.locator('.raci-letter')).toHaveText([
    '执行人（R）',
    '负责人（A）',
    '顾问（C）',
    '知会（I）',
  ]);
  await expect(raci.getByRole('group', { name: '负责人（A）' }).locator('.raci-chip')).toHaveText([
    `${id}管理`,
  ]);
  await expect(raci.getByRole('group', { name: '执行人（R）' }).locator('.raci-chip')).toHaveText([
    `${id}组员`,
  ]);
  // 只剩一个执行人 / 负责人时不能去掉
  await expect(raci.getByRole('button', { name: /^从执行人（R）中去掉/ })).toHaveCount(0);
  await expect(raci.getByRole('button', { name: /^从负责人（A）中去掉/ })).toHaveCount(0);
  await expect(
    raci
      .getByRole('combobox', { name: '添加执行人（R）' })
      .getByRole('option', { name: `${id}顾问` }),
  ).toHaveCount(0);
  await raci.getByRole('combobox', { name: '添加顾问（C）' }).selectOption({ label: `${id}顾问` });
  await raci.getByRole('combobox', { name: '添加知会（I）' }).selectOption({ label: `${id}组长` });
  await bar.locator('input[aria-label="截止日期"]').fill(localDate(-1));
  await bar.getByRole('button', { name: '创建', exact: true }).click();
  await expect(pa.getByLabel('快速添加任务')).toHaveValue('');

  const [task] = await select<{ id: string }>(A, `tasks?select=id&title=eq.${title}`);
  const assignments = await select<{
    role: string;
    user_id: string | null;
    contact_id: string | null;
  }>(M, `task_assignments?select=role,user_id,contact_id&task_id=eq.${task!.id}&order=role`);
  expect(assignments).toEqual([
    { role: 'A', user_id: await userId(A), contact_id: null },
    { role: 'C', user_id: null, contact_id: contact.id },
    { role: 'I', user_id: await userId(L), contact_id: null },
    { role: 'R', user_id: await userId(M), contact_id: null },
  ]);

  // 组员（执行人）：收到"把你设为执行人"，点查看进入项目，在清单里原地展开这条任务（只能看，不能改内容）；
  // 当前状态（未完成）看不到这条已经过了截止时间的任务，切到"已错过"
  const pm = await openAs(browser, M);
  await expect(bell(pm)).toHaveAttribute('data-unread', 'true');
  await openNotifications(pm);
  await expect(notificationText(pm, '设为')).toHaveText(`${id}管理把你设为${title}的执行人（R）`);
  await notification(pm, '设为').getByRole('button', { name: '查看' }).click();
  await expect(pm).toHaveURL(new RegExp(`group=${groupId}&project=${projectId}&status=missed$`));
  await expect(taskItem(pm, title)).toHaveClass(/task-item-open/);
  const panel = editPanel(pm);
  await expect(titleBox(panel)).toHaveValue(title);
  await expect(titleBox(panel)).toHaveAttribute('readonly', '');
  await expect(panel.getByRole('button', { name: '删除任务' })).toHaveCount(0);
  await expect(panel.getByRole('textbox', { name: '描述' })).toBeDisabled();
  // 所有成员都能看到这条任务上的 RACI
  await expect(panel.getByRole('group', { name: '执行人（R）' }).locator('.raci-chip')).toHaveText([
    `${id}组员`,
  ]);
  await expect(panel.getByRole('group', { name: '顾问（C）' }).locator('.raci-chip')).toHaveText([
    `${id}顾问`,
  ]);
  await expect(panel.getByRole('combobox')).toHaveCount(0);
  // 执行人标记完成 → 待确认
  await pm.getByRole('checkbox', { name: `完成：${title}` }).click();
  await panel.getByRole('button', { name: '完成编辑' }).click();
  await expect(panel).toHaveCount(0);
  await selectStatus(pm, '待确认');
  await expect(taskItem(pm, title)).toBeVisible();
  // 截止时间已经过了，但待确认不算已错过；也不算已完成
  await selectStatus(pm, '已错过');
  await expect(taskItem(pm, title)).toHaveCount(0);
  await selectStatus(pm, '已完成');
  await expect(taskItem(pm, title)).toHaveCount(0);

  // 负责人收到"完成"：只有"确认"和"查看"两个按钮；知会（组长）也收到，但不能确认
  await pa.reload();
  await openNotifications(pa);
  const done = notification(pa, '完成了');
  await expect(done.locator('.notification-text')).toHaveText(`${id}组员完成了${title}`);
  await expect(done.getByRole('button')).toHaveText(['查看', '确认']);
  const pl = await openAs(browser, L);
  await openNotifications(pl);
  await expect(notificationText(pl, '完成了')).toHaveText(`${id}组员完成了${title}`);
  await expect(notification(pl, '完成了').getByRole('button', { name: '确认' })).toHaveCount(0);
  await expect(notificationText(pl, '设为')).toHaveText(
    `${id}管理把${id}组员设为${title}的执行人（R）`,
  );

  // 负责人点查看，在任务详情里点"不通过"：任务回到未完成，执行人收到"退回了"
  await done.getByRole('button', { name: '查看' }).click();
  const aPanel = editPanel(pa);
  await aPanel
    .getByRole('group', { name: '完成确认' })
    .getByRole('button', { name: '不通过' })
    .click();
  await expect(aPanel.getByRole('group', { name: '完成确认' })).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (
          await select<{ completed_at: string | null }>(
            A,
            `tasks?select=completed_at&id=eq.${task!.id}`,
          )
        )[0],
    )
    .toEqual({ completed_at: null });
  await pm.reload();
  await openNotifications(pm);
  await expect(notificationText(pm, '退回了')).toHaveText(`${id}管理退回了${title}`);

  // 执行人再次标记完成（清单里勾选），负责人在通知里直接"确认"：已完成
  await notification(pm, '退回了').getByRole('button', { name: '关闭这条通知' }).click();
  await expect(notification(pm, '退回了')).toHaveCount(0);
  await selectStatus(pm, '已错过');
  await pm.getByRole('checkbox', { name: `完成：${title}` }).click();
  await selectStatus(pm, '待确认');
  await expect(taskItem(pm, title)).toBeVisible();
  await pa.reload();
  await openNotifications(pa);
  await notification(pa, '完成了').getByRole('button', { name: '确认' }).click();
  await expect(notification(pa, '完成了')).toHaveCount(0);
  await selectStatus(pa, '已完成');
  await expect(taskItem(pa, title)).toBeVisible();

  // 不是 R 的人不能勾选完成（组长是 I）
  await groupTask(A, projectId, `${id} 别人的任务`, [
    { role: 'R', userId: await userId(M) },
    { role: 'A', userId: await userId(A) },
  ]);
  await pl.reload();
  await projectLink(pl, projectName).click();
  await expect(pl.getByRole('checkbox', { name: `完成：${id} 别人的任务` })).toBeDisabled();

  // R 和 A 是同一个人：标记完成直接算已完成
  await groupTask(A, projectId, `${id} 自己负责自己确认`, [
    { role: 'R', userId: await userId(A) },
    { role: 'A', userId: await userId(A) },
  ]);
  await pa.reload();
  await selectStatus(pa, '未完成');
  await pa.getByRole('checkbox', { name: `完成：${id} 自己负责自己确认` }).click();
  await selectStatus(pa, '已完成');
  await expect(taskItem(pa, `${id} 自己负责自己确认`)).toBeVisible();

  // 责任分配矩阵：标题行右边切换；每行一条任务、每列一个人（含只有名字的人），格子里是字母
  await selectStatus(pa, '全部');
  await pa.getByRole('link', { name: '切换到责任分配矩阵' }).click();
  await expect(pa).toHaveURL(/view=raci/);
  const table = pa.getByRole('table', { name: '责任分配矩阵' });
  await expect(table.locator('thead th')).toHaveText([
    '',
    `${id}组长`,
    `${id}管理`,
    `${id}组员`,
    `${id}顾问`,
  ]);
  const row = table.locator('tbody tr').filter({ hasText: title });
  await expect(row.locator('td')).toHaveText(['I', 'A', 'R', 'C']);
  // 和清单共用同一个状态行；表格里不能改
  await selectStatus(pa, '已完成');
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await expect(table.locator('select, input')).toHaveCount(0);
  await pa.getByRole('link', { name: '切换到清单' }).click();
  await expect(pa).not.toHaveURL(/view=raci/);

  await Promise.all([pl, pa, pm].map((p) => p.context().close()));
});

test('踢出组与退出组：在任何项目上有 R 或 A 时失败并列出 RACI；否则确认窗口列出 C、I，确认后一并去掉；最后一位组长不能退出；合作组直接退出', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const id = runId();
  const { L, A, M, others, groupId, groupName, projectId, projectName } = await managementGroup(
    id,
    [`${id}被踢`, `${id}要走`],
  );
  const [kicked, leaver] = others as [GroupUser, GroupUser];
  const mId = await userId(M);
  const t1 = `${id} 有R的任务`;
  await groupTask(A, projectId, t1, [
    { role: 'R', userId: mId },
    { role: 'A', userId: await userId(A) },
    { role: 'I', userId: await userId(kicked) },
    { role: 'C', userId: await userId(leaver) },
  ]);

  const pl = await openAs(browser, L);
  await groupLink(pl, groupName).click();
  await openRoster(pl);

  // 踢出身上有 R 的人：失败，列出他在本组所有项目的任务上的 R、A、C、I（带项目名）
  await rosterAction(pl, `${id}组员`, '踢出');
  await expect(confirmDialog(pl)).toHaveAccessibleName(`不能踢出「${id}组员」`);
  await expect(confirmDialog(pl).locator('.raci-roles-list li')).toHaveText([
    `${projectName}${t1}R`,
  ]);
  await expect(confirmDialog(pl).getByRole('button', { name: '踢出' })).toHaveCount(0);
  await confirmDialog(pl).getByRole('button', { name: '关闭' }).click();
  await expect(rosterRow(pl, `${id}组员`)).toBeVisible();

  // 踢出只有 I 的人：确认窗口列出他的 C、I；确认后踢出，I 一并去掉
  await rosterAction(pl, `${id}被踢`, '踢出');
  await expect(confirmDialog(pl)).toHaveAccessibleName(`踢出「${id}被踢」？`);
  await expect(confirmDialog(pl).locator('.raci-roles-list li')).toHaveText([
    `${projectName}${t1}I`,
  ]);
  await confirmDialog(pl).getByRole('button', { name: '踢出' }).click();
  await expect(rosterRow(pl, `${id}被踢`)).toHaveCount(0);
  expect(
    await select(A, `task_assignments?select=role&user_id=eq.${await userId(kicked)}`),
  ).toEqual([]);
  // 踢出组 = 同时移出他所在的所有项目
  expect(await select(kicked, `groups?select=id&id=eq.${groupId}`)).toEqual([]);
  expect(await select(kicked, `projects?select=id&id=eq.${projectId}`)).toEqual([]);

  // 只有组长能踢人（项目管理员也不行）：数据库也拦住
  await expect(
    rpc(A, 'remove_group_member', { p_group_id: groupId, p_user_id: mId }),
  ).rejects.toThrow(/没有踢出这个人的权限/);

  // 组员退出：身上有 R 时失败，列出 RACI
  const pm = await openAs(browser, M);
  await groupLink(pm, groupName).click();
  await openRoster(pm);
  await rosterAction(pm, `${id}组员`, '退出组');
  await expect(confirmDialog(pm)).toHaveAccessibleName('不能退出');
  await expect(confirmDialog(pm).locator('.raci-roles-list li')).toHaveText([
    `${projectName}${t1}R`,
  ]);
  await confirmDialog(pm).getByRole('button', { name: '关闭' }).click();

  // 只有 C 的人退出：确认窗口列出 C；退出后 C 一并去掉，回到总览
  const pv = await openAs(browser, leaver);
  await groupLink(pv, groupName).click();
  await openRoster(pv);
  await rosterAction(pv, `${id}要走`, '退出组');
  await expect(confirmDialog(pv)).toHaveAccessibleName(`退出「${groupName}」？`);
  await expect(confirmDialog(pv).locator('.raci-roles-list li')).toHaveText([
    `${projectName}${t1}C`,
  ]);
  await confirmDialog(pv).getByRole('button', { name: '退出' }).click();
  await expect(titleBar(pv)).toHaveText('总览');
  await expect(groupLink(pv, groupName)).toHaveCount(0);
  expect(
    await select(A, `task_assignments?select=role&user_id=eq.${await userId(leaver)}`),
  ).toEqual([]);

  // 最后一位组长不能退出
  await rosterAction(pl, `${id}组长`, '退出组');
  await expect(confirmDialog(pl)).toHaveAccessibleName('最后一位组长不能退出');
  await confirmDialog(pl).getByRole('button', { name: '关闭' }).click();
  expect(await rpc(L, 'leave_group', { p_group_id: groupId })).toBe('last_leader');

  // 项目管理员（没有 R、A）可以退出组：先把负责人换成组长（执行人和负责人不能删光）
  expect(
    await rpc(A, 'set_task_raci', {
      p_task_id: (await select<{ id: string }>(A, `tasks?select=id&title=eq.${t1}`))[0]!.id,
      p_assignments: [
        { role: 'R', user_id: mId },
        { role: 'A', user_id: await userId(L) },
      ],
    }),
  ).toBeNull();
  expect(await rpc(A, 'leave_group', { p_group_id: groupId })).toBe('left');

  // 合作组（项目没开任务分配）：直接退出；最后一个成员退出时组和项目、任务一起删除
  const coop = `${id}合作组`;
  const coopId = await groupWith(L, [M], coop);
  await groupTask(L, await projectIn(L, coopId, `${id}合作项目`), `${id} 合作组任务`);
  await pm.reload();
  await groupLink(pm, coop).click();
  await openRoster(pm);
  await rosterAction(pm, `${id}组员`, '退出组');
  await expect(confirmDialog(pm)).toHaveAccessibleName(`退出「${coop}」？`);
  await confirmDialog(pm).getByRole('button', { name: '退出' }).click();
  await expect(titleBar(pm)).toHaveText('总览');
  await pl.reload();
  await groupLink(pl, coop).click();
  await openRoster(pl);
  await expect(rosterDialog(pl).locator('.roster-name')).toHaveText([`${id}组长`]);
  await rosterAction(pl, `${id}组长`, '退出组');
  await confirmDialog(pl).getByRole('button', { name: '退出' }).click();
  await expect(titleBar(pl)).toHaveText('总览');
  await expect(groupLink(pl, coop)).toHaveCount(0);
  expect(await select(L, `tasks?select=id&group_id=eq.${coopId}`)).toEqual([]);

  await Promise.all([pl, pm, pv].map((p) => p.context().close()));
});

test('任命组长：全体组长投票，发起者算同意；一个不同意就取消；三天不操作算同意（固定时钟）', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  test.skip(!dbUrl(), '需要 E2E_DATABASE_URL 才能固定数据库时钟');
  const id = runId();
  const { L, A, others, groupId, groupName } = await managementGroup(id, [`${id}候选`]);
  const [candidate] = others as [GroupUser];

  // 只有一位组长时，任命立即生效（发起者就是全体组长）
  const pl = await openAs(browser, L);
  await groupLink(pl, groupName).click();
  await openRoster(pl);
  await rosterAction(pl, `${id}管理`, '任命为组长');
  await expect(confirmDialog(pl)).toHaveAccessibleName(`任命「${id}管理」为组长？`);
  await confirmDialog(pl).getByRole('button', { name: '任命' }).click();
  await expect(roleOf(pl, `${id}管理`)).toHaveText('组长');
  // 组长不能被撤销：没有撤销的操作
  await expect(
    rosterRow(pl, `${id}管理`).getByRole('button', { name: `「${id}管理」的操作` }),
  ).toHaveCount(0);

  // 现在有两位组长：任命组员要另一位组长投票；他不同意就取消
  await rosterAction(pl, `${id}组员`, '任命为组长');
  await confirmDialog(pl).getByRole('button', { name: '任命' }).click();
  await expect(roleOf(pl, `${id}组员`)).toHaveText('组员');
  const pa = await openAs(browser, A);
  await openNotifications(pa);
  const vote = notification(pa, '提议任命');
  await expect(vote).toHaveText(new RegExp(`${id}组长提议任命${id}组员为「${groupName}」的组长`));
  await vote.getByRole('button', { name: '不同意' }).click();
  await expect(vote).toHaveCount(0);
  await pl.reload();
  await groupLink(pl, groupName).click();
  await openRoster(pl);
  await expect(roleOf(pl, `${id}组员`)).toHaveText('组员');

  // 另一位组长同意：任命生效
  await rosterAction(pl, `${id}组员`, '任命为组长');
  await confirmDialog(pl).getByRole('button', { name: '任命' }).click();
  await pa.reload();
  await openNotifications(pa);
  await notification(pa, '提议任命').getByRole('button', { name: '同意', exact: true }).click();
  await expect(notification(pa, '提议任命')).toHaveCount(0);
  await pl.reload();
  await groupLink(pl, groupName).click();
  await openRoster(pl);
  await expect(roleOf(pl, `${id}组员`)).toHaveText('组长');

  // 三天不操作算同意：固定数据库时钟，组里任何人打开 TaskApp 时检查
  const start = new Date(Date.now() - 60_000);
  const DAY = 86_400_000;
  try {
    setDbClock(start);
    expect(
      await rpc(L, 'request_leader_appointment', {
        p_group_id: groupId,
        p_user_id: await userId(candidate),
      }),
    ).toBe('requested');
    setDbClock(new Date(start.getTime() + 3 * DAY - 60_000));
    const pc = await openAs(browser, candidate);
    await groupLink(pc, groupName).click();
    await openRoster(pc);
    await expect(roleOf(pc, `${id}候选`)).toHaveText('组员');
    await pc.keyboard.press('Escape');

    setDbClock(new Date(start.getTime() + 3 * DAY));
    await pc.reload();
    await openRoster(pc);
    await expect(roleOf(pc, `${id}候选`)).toHaveText('组长');
    expect(await select(L, `group_leader_requests?select=id&group_id=eq.${groupId}`)).toEqual([]);
    await pc.context().close();
  } finally {
    setDbClock(null);
  }

  await Promise.all([pl, pa].map((p) => p.context().close()));
});

test('标题行和添加栏在每个页面都在同一个位置：总览、收藏、组、项目（清单与责任分配矩阵）', async ({
  browser,
}) => {
  const id = runId();
  const L = await user('pl', `${id}组长`);
  const coopId = await groupWith(L, [], `${id}合作组`);
  await projectIn(L, coopId, `${id}合作项目`);
  const mgmtId = await groupWith(L, [], `${id}管理组`, 'management');
  await projectIn(L, mgmtId, `${id}分配项目`, ['assignment']);
  const page = await openAs(browser, L);

  const boxes = async () => {
    const title = (await page.locator('h1.title-bar').boundingBox())!;
    const input = (await page.getByLabel('快速添加任务').boundingBox())!;
    return { titleY: title.y, titleH: title.height, input };
  };
  await expect(titleBar(page)).toHaveText('总览');
  const base = await boxes();

  const check = async () => expect(await boxes()).toEqual(base);
  await sidebar(page).getByRole('link', { name: /收藏/ }).click();
  await expect(titleBar(page)).toHaveText('收藏');
  await check();
  await groupLink(page, `${id}合作组`).click();
  await expect(titleBar(page)).toHaveText(`${id}合作组`);
  await check();
  await projectLink(page, `${id}合作项目`).click();
  await expect(titleBar(page)).toHaveText(`${id}合作项目`);
  await check();
  await groupLink(page, `${id}管理组`).click();
  await expect(titleBar(page)).toHaveText(`${id}管理组`);
  // 组页面没有责任分配矩阵
  await expect(page.getByRole('link', { name: '切换到责任分配矩阵' })).toHaveCount(0);
  await check();
  await projectLink(page, `${id}分配项目`).click();
  await expect(titleBar(page)).toHaveText(`${id}分配项目`);
  await check();
  await page.getByRole('link', { name: '切换到责任分配矩阵' }).click();
  await expect(page).toHaveURL(/view=raci/);
  await check();
  await page.context().close();
});
