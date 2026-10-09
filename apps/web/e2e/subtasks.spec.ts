import { expect, test, type Page } from '@playwright/test';

import {
  bell,
  groupTask,
  groupWith,
  notificationList,
  openAs,
  projectIn,
  projectLink,
  rpc,
  select,
  user,
  userId,
} from './group-helpers';
import { editPanel, localDate, openTask, quickAdd, runId, switchMode, taskItem } from './helpers';

// 多个账号各用自己的浏览器上下文：从"没登录"开始
test.use({ storageState: { cookies: [], origins: [] } });

const progress = (page: Page, title: string) => taskItem(page, title).locator('.subtask-toggle');
const subtaskCheck = (page: Page, title: string, sub: string) =>
  taskItem(page, title).getByRole('checkbox', { name: `完成子任务：${sub}`, exact: true });

/** 在编辑面板里把子任务清单写成 titles（只加新的），点 ✓ 保存 */
async function addSubtasks(page: Page, titles: string[]) {
  const panel = editPanel(page);
  const group = panel.getByRole('group', { name: '子任务' });
  const before = await group.getByRole('textbox').count();
  for (const [i, title] of titles.entries()) {
    await group.getByRole('button', { name: '添加子任务' }).click();
    await group
      .getByRole('textbox', { name: `第 ${before + i + 1} 个子任务`, exact: true })
      .fill(title);
  }
}

test('子任务：只有标题和勾选，挂在父任务下面可以展开收起，父任务上显示进度；点 ✓ 才保存；勾完不自动完成父任务，父任务勾完成时一起勾上', async ({
  browser,
}) => {
  const id = runId();
  const me = await user('sub', `${id}我`);
  const page = await openAs(browser, me);
  const title = `${id} 搬家`;
  await quickAdd(page, title, { deadline: localDate(1) });
  await openTask(page, title);
  await addSubtasks(page, ['打包', '叫车', '退押金']);
  // 点别处不保存：先问，放弃修改后清单没有变
  await page
    .locator('h1.title-bar')
    .first()
    .click({ position: { x: 2, y: 2 } });
  await page.getByRole('alertdialog').getByRole('button', { name: '放弃修改' }).click();
  await expect(progress(page, title)).toHaveCount(0);
  // 再加一次，点 ✓ 保存
  await openTask(page, title);
  await addSubtasks(page, ['打包', '叫车', '退押金']);
  await editPanel(page).getByRole('button', { name: '完成编辑' }).first().click();
  await expect(progress(page, title)).toHaveText('0/3');

  // 展开 / 收起，勾选立即生效
  await progress(page, title).click();
  await expect(progress(page, title)).toHaveAttribute('aria-expanded', 'true');
  await subtaskCheck(page, title, '打包').check();
  await subtaskCheck(page, title, '叫车').check();
  await subtaskCheck(page, title, '退押金').check();
  await expect(progress(page, title)).toHaveText('3/3');
  // 勾完全部子任务，父任务不会自动完成
  await expect(taskItem(page, title).locator('.task-check').first()).not.toBeChecked();
  await subtaskCheck(page, title, '退押金').uncheck();
  await expect(progress(page, title)).toHaveText('2/3');
  await progress(page, title).click();
  await expect(taskItem(page, title).locator('.subtask-list')).toHaveCount(0);

  // 父任务直接勾完成：没勾的子任务一起勾上
  await taskItem(page, title)
    .getByRole('checkbox', { name: `完成：${title}` })
    .click();
  await expect
    .poll(async () => (await select<unknown>(me, 'task_subtask_checks?select=subtask_id')).length)
    .toBe(3);
  // 子任务不单独出现在矩阵里
  await page.goto('/?status=all');
  await expect(progress(page, title)).toHaveText('3/3');
  await switchMode(page, 'matrix');
  await expect(page.locator('.matrix-node[aria-label^="打包，"]')).toHaveCount(0);
  await page.context().close();
});

test('组任务的子任务：管理员改清单（点 ✓ 保存，按"修改"通知，字段"子任务"）；开了任务分配时只有执行人能勾，没开时项目成员都能勾；勾选不发通知', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const id = runId();
  const L = await user('sl', `${id}组长`);
  const M = await user('sm', `${id}组员`);
  const groupId = await groupWith(L, [M], `${id}组`, 'management');
  const assign = await projectIn(L, groupId, `${id}分配`, ['assignment'], [M]);
  const plain = await projectIn(L, groupId, `${id}普通`, [], [M]);
  const [lId, mId] = [await userId(L), await userId(M)];
  const title = `${id} 发布`;
  await groupTask(L, assign, title, [
    { role: 'R', userId: mId },
    { role: 'A', userId: lId },
  ]);
  await groupTask(L, plain, `${id} 普通的事`);
  const notes = async () =>
    (await rpc<{ kind: string; action: string; fields: string[] }[]>(M, 'my_notifications')).filter(
      (n) => n.kind === 'task' && n.action === 'modified',
    );
  const before = (await notes()).length;

  const pl = await openAs(browser, L);
  await projectLink(pl, `${id}分配`).click();
  await openTask(pl, title);
  await addSubtasks(pl, ['写说明', '打标签']);
  await editPanel(pl).getByRole('button', { name: '完成编辑' }).first().click();
  await expect(progress(pl, title)).toHaveText('0/2');
  await expect.poll(async () => (await notes()).length).toBe(before + 1);
  expect((await notes()).at(-1)?.fields).toEqual(['subtasks']);
  // 组长不是执行人：不能勾
  await progress(pl, title).click();
  await expect(subtaskCheck(pl, title, '写说明')).toBeDisabled();

  // 执行人能勾；勾选不发通知
  const pm = await openAs(browser, M);
  await projectLink(pm, `${id}分配`).click();
  await progress(pm, title).click();
  await subtaskCheck(pm, title, '写说明').check();
  await expect(progress(pm, title)).toHaveText('1/2');
  await bell(pm).click();
  await expect(notificationList(pm)).toContainText(`${id}组长修改了${title}的子任务`);
  await pm.keyboard.press('Escape');
  expect((await notes()).length).toBe(before + 1);

  // 没开任务分配的项目：项目成员都能勾
  await projectLink(pl, `${id}普通`).click();
  await openTask(pl, `${id} 普通的事`);
  await addSubtasks(pl, ['一']);
  await editPanel(pl).getByRole('button', { name: '完成编辑' }).first().click();
  await expect(progress(pl, `${id} 普通的事`)).toHaveText('0/1');
  await pm.reload();
  await projectLink(pm, `${id}普通`).click();
  await progress(pm, `${id} 普通的事`).click();
  await subtaskCheck(pm, `${id} 普通的事`, '一').check();
  await expect(progress(pm, `${id} 普通的事`)).toHaveText('1/1');
  await pl.context().close();
  await pm.context().close();
});

test('循环任务的子任务：清单属于任务本身，勾选属于每一次，各次互不相关；改清单只影响以后，过去各次的历史保持原样', async ({
  browser,
}) => {
  const id = runId();
  const me = await user('rs', `${id}我`);
  const page = await openAs(browser, me);
  const title = `${id} 每天打卡`;
  await quickAdd(page, title);
  const [task] = await select<{ id: string }>(
    me,
    `tasks?select=id&title=eq.${encodeURIComponent(title)}`,
  );
  // 从前天 23:59 开始每天一次：前天、昨天的已过，当前代表是今天 23:59
  const start = new Date(`${localDate(-2)}T23:59:00+08:00`).toISOString();
  const patch = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/tasks?id=eq.${task!.id}`,
    {
      method: 'PATCH',
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${await (await import('./auth')).accessTokenFor(me)}`,
        'Content-Profile': 'taskapp',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recurrence_rule: 'FREQ=DAILY', recurrence_dtstart: start }),
    },
  );
  expect(patch.ok).toBe(true);
  await page.reload();
  await openTask(page, title);
  await addSubtasks(page, ['喝水', '散步']);
  await editPanel(page).getByRole('button', { name: '完成编辑' }).first().click();
  await expect(progress(page, title)).toHaveText('0/2');

  // 勾这一次的一个，再完成这一次：这一次没勾的一起勾上；下一次从 0 开始
  await progress(page, title).click();
  await subtaskCheck(page, title, '喝水').check();
  await expect(progress(page, title)).toHaveText('1/2');
  await taskItem(page, title)
    .getByRole('checkbox', { name: `完成本次：${title}` })
    .click();
  await expect(progress(page, title)).toHaveText('0/2');
  const checks = await select<{ occurrence_date: string }>(
    me,
    'task_subtask_checks?select=occurrence_date',
  );
  expect(checks).toHaveLength(2);
  expect(new Set(checks.map((c) => new Date(c.occurrence_date).toISOString()))).toEqual(
    new Set([new Date(`${localDate(0)}T23:59:00+08:00`).toISOString()]),
  );

  // 改清单（加一个）：只影响以后；历史里完成的那一次仍是 2/2
  await openTask(page, title);
  await addSubtasks(page, ['早睡']);
  await editPanel(page).getByRole('button', { name: '完成编辑' }).first().click();
  await expect(progress(page, title)).toHaveText('0/3');
  await openTask(page, title);
  const history = editPanel(page).locator('.history-row-inline');
  await expect(history.filter({ hasText: '23:59' }).locator('.history-progress')).toContainText([
    '2/2',
  ]);
  await page.context().close();
});
