import { expect, test } from '@playwright/test';

import {
  collapse,
  createCategory,
  dateInput,
  editPanel,
  expectTitles,
  localDate,
  openCategory,
  openTask,
  queryRest,
  quickAdd,
  quickAddBar,
  runId,
  saveAndCollapse,
  selectStatus,
  sidebar,
  taskItem,
  toast,
  waitSaved,
} from './helpers';

test('快速添加带重要性与截止日期、按截止时间排序、状态筛选、完成任务', async ({ page }) => {
  const id = runId();
  const t = (name: string) => `${id} ${name}`;
  await page.goto('/');

  // 选项行默认：重要性 0、没有截止日期
  const bar = quickAddBar(page);
  await expect(bar.getByRole('button', { name: '重要性 0', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(dateInput(bar)).toHaveValue('');

  await quickAdd(page, t('无截止'));
  await quickAdd(page, t('下周'), { deadline: localDate(7) });
  await quickAdd(page, t('明天'), { deadline: localDate(1), importance: 4 });
  await quickAdd(page, t('已过期'), { deadline: localDate(-1), expectVisible: false });

  // 创建后选项恢复默认
  await expect(bar.getByRole('button', { name: '重要性 0', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(dateInput(bar)).toHaveValue('');

  // 默认视图 = 未完成：截止时间从近到远，无截止时间排最后；已过期的不在待办中
  await expectTitles(page, id, [t('明天'), t('下周'), t('无截止')]);
  const tomorrowRow = taskItem(page, t('明天'));
  // 截止时间只精确到天：不显示时刻
  await expect(tomorrowRow.locator('.task-deadline')).toHaveText('明天');
  await expect(tomorrowRow).toContainText('重要性 4');

  await selectStatus(page, '已错过');
  await expectTitles(page, id, [t('已过期')]);
  await expect(taskItem(page, t('已过期'))).toContainText('已错过');

  // 完成任务后离开未完成，出现在已完成
  await selectStatus(page, '未完成');
  // 未完成视图中勾选后任务立即离开列表，因此用 click 而不是 check
  await page.getByRole('checkbox', { name: `完成：${t('明天')}` }).click();
  await expect(taskItem(page, t('明天'))).toHaveCount(0);
  await selectStatus(page, '已完成');
  await expectTitles(page, id, [t('明天')]);

  await selectStatus(page, '全部');
  await expectTitles(page, id, [t('已过期'), t('明天'), t('下周'), t('无截止')]);

  // 筛选条件保存在 URL 中，刷新后保持
  await expect(page).toHaveURL(/\/list\/all/);
  await page.reload();
  await expectTitles(page, id, [t('已过期'), t('明天'), t('下周'), t('无截止')]);

  // 在面板里改截止日期与重要性：自动保存，列表随之重排
  await openTask(page, t('无截止'));
  await dateInput(editPanel(page)).fill(localDate(3));
  await waitSaved(page);
  await collapse(page);
  await expectTitles(page, id, [t('已过期'), t('明天'), t('无截止'), t('下周')]);
  await page.reload();
  await expectTitles(page, id, [t('已过期'), t('明天'), t('无截止'), t('下周')]);
});

test('分类：新建、在面板中多选、列表多选筛选（命中即显示）', async ({ page }) => {
  const id = runId();
  const t = (name: string) => `${id} ${name}`;
  const work = `${id}工作`;
  const home = `${id}家庭`;
  await page.goto('/');

  for (const name of [work, home]) await createCategory(page, name);
  await selectStatus(page, '未完成');
  const categoryBar = page.getByRole('group', { name: '分类筛选' });

  for (const name of ['只工作', '工作和家庭', '无分类']) await quickAdd(page, t(name));

  await openTask(page, t('只工作'));
  await editPanel(page)
    .getByRole('group', { name: '分类' })
    .getByRole('button', { name: work })
    .click();
  await saveAndCollapse(page);

  await openTask(page, t('工作和家庭'));
  const panelCategories = editPanel(page).getByRole('group', { name: '分类' });
  await panelCategories.getByRole('button', { name: work }).click();
  await panelCategories.getByRole('button', { name: home }).click();
  await saveAndCollapse(page);

  await expect(taskItem(page, t('工作和家庭'))).toContainText(home);

  await categoryBar.getByRole('button', { name: home }).click();
  await expectTitles(page, id, [t('工作和家庭')]);

  await categoryBar.getByRole('button', { name: work }).click();
  await expectTitles(page, id, [t('工作和家庭'), t('只工作')]);

  // 展开面板不影响筛选；刷新后筛选保持
  await openTask(page, t('只工作'));
  await collapse(page);
  await page.reload();
  await expect(categoryBar.getByRole('button', { name: work })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expectTitles(page, id, [t('工作和家庭'), t('只工作')]);

  await categoryBar.getByRole('button', { name: work }).click();
  await categoryBar.getByRole('button', { name: home }).click();
  await expectTitles(page, id, [t('无分类'), t('工作和家庭'), t('只工作')]);
});

test('删除任务：无确认框，提示条可撤销；删除为软删除；旧的详情路由已移除', async ({
  page,
  request,
}) => {
  const id = runId();
  const title = `${id} 要删除`;
  await page.goto('/');
  await quickAdd(page, title);
  const taskId = await openTask(page, title);
  await editPanel(page).getByRole('textbox', { name: '描述' }).fill('删除前的描述');
  await waitSaved(page);

  // 删除：没有确认框，任务立即消失，提示条带撤销
  let dialogs = 0;
  page.on('dialog', () => dialogs++);
  await editPanel(page).getByRole('button', { name: '删除任务' }).click();
  await expect(taskItem(page, title)).toHaveCount(0);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  const deleted = toast(page, `已删除「${title}」`);
  await expect(deleted).toBeVisible();

  // 撤销：任务恢复，内容完整
  await deleted.getByRole('button', { name: '撤销' }).click();
  await expect(taskItem(page, title)).toBeVisible();
  await openTask(page, title);
  await expect(editPanel(page).getByRole('textbox', { name: '描述' })).toHaveValue('删除前的描述');

  // 再删一次，不撤销：提示条几秒后自动消失
  await editPanel(page).getByRole('button', { name: '删除任务' }).click();
  await expect(taskItem(page, title)).toHaveCount(0);
  await expect(toast(page, `已删除「${title}」`)).toHaveCount(0, { timeout: 8000 });
  await page.reload();
  await expect(page.getByLabel('快速添加任务')).toBeVisible();
  await expect(taskItem(page, title)).toHaveCount(0);
  expect(dialogs).toBe(0);

  const rows = await queryRest<{ title: string; deleted_at: string | null }[]>(
    request,
    `tasks?id=eq.${taskId}&select=title,deleted_at`,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]!.title).toBe(title);
  expect(rows[0]!.deleted_at).not.toBeNull();

  // 旧的 /tasks/[id] 详情页已移除；历史记录页仍然存在
  const old = await page.goto(`/tasks/${taskId}`);
  expect(old?.status()).toBe(404);
  const history = await page.goto(`/tasks/${taskId}/history`);
  expect(history?.status()).toBe(200);
});

test('空白标题：快速添加忽略；面板中清空标题提示错误且不保存', async ({ page, request }) => {
  const id = runId();
  await page.goto('/');
  const input = page.getByLabel('快速添加任务');
  await input.fill('   ');
  await input.press('Enter');
  await expect(input).toHaveValue('   ');
  await input.fill('');

  await quickAdd(page, `  ${id} 有空格  `);
  const taskId = await openTask(page, `${id} 有空格`);
  await editPanel(page).getByLabel('标题').fill('   ');
  await expect(editPanel(page)).toContainText('标题不能为空');
  await expect(editPanel(page)).toHaveAttribute('data-save-state', 'invalid');
  await collapse(page);

  const [row] = await queryRest<{ title: string }[]>(request, `tasks?id=eq.${taskId}&select=title`);
  expect(row!.title).toBe(`${id} 有空格`);
});

test('快速添加：只点亮一个分类时自动归入该分类；多选或总览时不带分类', async ({ page }) => {
  const id = runId();
  const t = (name: string) => `${id} ${name}`;
  const work = `${id}工作`;
  const home = `${id}家庭`;
  await page.goto('/');

  for (const name of [work, home]) await createCategory(page, name);
  await selectStatus(page, '未完成');
  const categoryBar = page.getByRole('group', { name: '分类筛选' });
  const row = (name: string) => taskItem(page, t(name));

  // 只点亮「工作」：新任务自动归入，且立即出现在当前筛选视图中
  await categoryBar.getByRole('button', { name: work }).click();
  await expect(page.getByLabel('快速添加任务')).toHaveAttribute(
    'placeholder',
    `添加到「${work}」，回车创建`,
  );
  await quickAdd(page, t('单选'));
  await expect(row('单选')).toContainText(work);

  // 展开面板：分类里已预选「工作」
  await quickAddBar(page).getByRole('button', { name: '展开完整选项' }).click();
  await expect(
    page.getByRole('form', { name: '新建任务' }).getByRole('button', { name: work }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '收起', exact: true }).click();

  // 同时点亮两个分类：不带分类（新任务不命中筛选，切回总览后可见）
  await categoryBar.getByRole('button', { name: home }).click();
  await expect(page.getByLabel('快速添加任务')).toHaveAttribute(
    'placeholder',
    '添加任务，回车创建',
  );
  await quickAdd(page, t('多选'), { expectVisible: false });

  // 回到总览：再新建一个，不带分类
  await categoryBar.getByRole('button', { name: work }).click();
  await categoryBar.getByRole('button', { name: home }).click();
  await quickAdd(page, t('总览'));

  await expect(row('多选')).toBeVisible();
  await expect(row('多选')).not.toContainText(work);
  await expect(row('多选')).not.toContainText(home);
  await expect(row('总览')).not.toContainText(work);
  await expect(row('总览')).not.toContainText(home);

  // 刷新后仍然成立（分类关联已写入数据库）
  await page.reload();
  await expect(row('单选')).toContainText(work);
  await expect(row('多选')).not.toContainText(work);
});

test('侧边栏分类页：只显示该分类的任务，页面内用状态标签筛选；快速添加自动归入该分类', async ({
  page,
}) => {
  const id = runId();
  const t = (name: string) => `${id} ${name}`;
  const work = `${id}工作`;
  await page.goto('/');
  await quickAdd(page, t('不属于分类'));
  await createCategory(page, work);

  // 分类页：默认"未完成"，快速添加的任务归入该分类
  const status = page.getByRole('group', { name: '状态筛选' });
  await expect(status.getByRole('button', { name: '未完成' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByLabel('快速添加任务')).toHaveAttribute(
    'placeholder',
    `添加到「${work}」，回车创建`,
  );
  await quickAdd(page, t('分类内一'));
  await quickAdd(page, t('分类内二'));
  await expectTitles(page, id, [t('分类内二'), t('分类内一')]);

  // 在分类页完成一个任务 → 离开"未完成"，出现在"已完成"
  await page.getByRole('checkbox', { name: `完成：${t('分类内一')}` }).click();
  await expectTitles(page, id, [t('分类内二')]);
  await status.getByRole('button', { name: '已完成' }).click();
  await expectTitles(page, id, [t('分类内一')]);
  await status.getByRole('button', { name: '全部' }).click();
  await expectTitles(page, id, [t('分类内二'), t('分类内一')]);
  await expect(page).toHaveURL(/status=all/);

  // 侧边栏计数：该分类下未完成 1 个
  await expect(
    sidebar(page).getByRole('region', { name: '分类' }).getByRole('link', { name: work }),
  ).toContainText('1');

  // 总览 · 全部：跨分类可见
  await selectStatus(page, '全部');
  await expect(taskItem(page, t('不属于分类'))).toBeVisible();
  await openCategory(page, work);
  await expect(taskItem(page, t('不属于分类'))).toHaveCount(0);
});

test('面板中标记完成：任务在收起前留在原位，收起后离开"未完成"', async ({ page }) => {
  const id = runId();
  const title = `${id} 面板完成`;
  await page.goto('/');
  await selectStatus(page, '未完成');
  await quickAdd(page, title);
  await openTask(page, title);
  await editPanel(page).getByRole('button', { name: '标记为完成' }).click();
  await waitSaved(page);
  await expect(editPanel(page).getByRole('button', { name: '标记为未完成' })).toBeVisible();
  await expect(taskItem(page, title)).toBeVisible();
  await collapse(page);
  await expect(taskItem(page, title)).toHaveCount(0);
  await selectStatus(page, '已完成');
  await expect(taskItem(page, title)).toBeVisible();
});
