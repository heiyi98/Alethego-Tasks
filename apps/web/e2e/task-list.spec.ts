import { expect, test } from '@playwright/test';

import {
  categoryToggle,
  collapse,
  createCategory,
  dateInput,
  editPanel,
  expectTitles,
  localDate,
  openTask,
  queryRest,
  quickAdd,
  quickAddBar,
  runId,
  saveAndCollapse,
  selectStatus,
  setTime,
  sidebar,
  taskItem,
  timeInput,
  titleBox,
  toast,
  toggleCategory,
  waitSaved,
} from './helpers';

test('快速添加带重要性与截止日期、按截止时间排序、状态筛选、完成任务', async ({ page }) => {
  const id = runId();
  const t = (name: string) => `${id} ${name}`;
  await page.goto('/');
  // 默认视图：全部
  await expect(page.getByRole('heading', { level: 1, name: '全部' })).toBeVisible();

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
  await quickAdd(page, t('已过期'), { deadline: localDate(-1) });

  // 创建后选项恢复默认
  await expect(bar.getByRole('button', { name: '重要性 0', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(dateInput(bar)).toHaveValue('');

  // 全部：截止时间从近到远，无截止时间排最后
  await expectTitles(page, id, [t('已过期'), t('明天'), t('下周'), t('无截止')]);

  // 截止时间显示：日期 + 星期 · 剩余天数；已过期显示逾期天数
  const deadlineOf = (name: string) => taskItem(page, t(name)).locator('.task-deadline');
  await expect(deadlineOf('明天')).toHaveText(/^\d+月\d+日 周. · 还剩1天$/);
  await expect(deadlineOf('下周')).toHaveText(/^\d+月\d+日 周. · 还剩7天$/);
  await expect(deadlineOf('已过期')).toHaveText(/^\d+月\d+日 周. · 逾期1天$/);
  await expect(taskItem(page, t('明天'))).toContainText('重要性 4');

  // 未完成：已过期的不在其中；快速添加栏只出现在"全部"
  await selectStatus(page, '未完成');
  await expectTitles(page, id, [t('明天'), t('下周'), t('无截止')]);
  await expect(page.getByLabel('快速添加任务')).toHaveCount(0);

  await selectStatus(page, '已错过');
  await expectTitles(page, id, [t('已过期')]);
  await expect(page.getByLabel('快速添加任务')).toHaveCount(0);

  // 完成任务后离开未完成，出现在已完成
  await selectStatus(page, '未完成');
  // 未完成视图中勾选后任务立即离开列表，因此用 click 而不是 check
  await page.getByRole('checkbox', { name: `完成：${t('明天')}` }).click();
  await expect(taskItem(page, t('明天'))).toHaveCount(0);
  await selectStatus(page, '已完成');
  await expectTitles(page, id, [t('明天')]);
  await expect(page.getByLabel('快速添加任务')).toHaveCount(0);

  // 选择保存在 URL 中，刷新后保持
  await expect(page).toHaveURL(/status=completed/);
  await page.reload();
  await expectTitles(page, id, [t('明天')]);

  // 在面板里改截止日期：自动保存，列表随之重排
  await selectStatus(page, '全部');
  await openTask(page, t('无截止'));
  await dateInput(editPanel(page)).fill(localDate(3));
  await waitSaved(page);
  await collapse(page);
  await expectTitles(page, id, [t('已过期'), t('明天'), t('无截止'), t('下周')]);
  await page.reload();
  await expectTitles(page, id, [t('已过期'), t('明天'), t('无截止'), t('下周')]);
});

test('具体时刻：没选时刻过完当天才算错过，选了时刻过了那一刻就算错过', async ({
  page,
  request,
}) => {
  const id = runId();
  const t = (name: string) => `${id} ${name}`;
  await page.goto('/');

  await quickAdd(page, t('今天全天'), { deadline: localDate(0) });
  // 今天 00:00 已经过去（除非恰好在午夜运行）
  await quickAdd(page, t('今天零点'), { deadline: localDate(0), time: '00:00' });
  await quickAdd(page, t('明早九点'), { deadline: localDate(1), time: '09:00' });

  const deadlineOf = (name: string) => taskItem(page, t(name)).locator('.task-deadline');
  await expect(deadlineOf('今天全天')).toHaveText('今天');
  await expect(deadlineOf('今天零点')).toHaveText('今天 00:00 · 已过');
  await expect(deadlineOf('明早九点')).toHaveText(/^\d+月\d+日 周. 09:00 · 还剩1天$/);

  await selectStatus(page, '未完成');
  await expectTitles(page, id, [t('今天全天'), t('明早九点')]);
  await selectStatus(page, '已错过');
  await expectTitles(page, id, [t('今天零点')]);

  // 面板中：时钟图标旁显示已选时刻；清除时刻 → 截止时间回到当天最后一刻
  await selectStatus(page, '全部');
  const taskId = await openTask(page, t('明早九点'));
  const panel = editPanel(page);
  await expect(timeInput(panel)).toHaveValue('09:00');
  await panel.getByRole('button', { name: '清除时刻' }).click();
  await expect(timeInput(panel)).toHaveCount(0);
  await waitSaved(page);
  const [row] = await queryRest<{ deadline_at: string }[]>(
    request,
    `tasks?id=eq.${taskId}&select=deadline_at`,
  );
  // Asia/Shanghai 当天 23:59:59.999 = UTC 15:59:59.999
  expect(new Date(row!.deadline_at).toISOString()).toMatch(/T15:59:59\.999Z$/);

  // 再选一个时刻
  await setTime(panel, '18:30');
  await waitSaved(page);
  await collapse(page);
  await expect(deadlineOf('明早九点')).toHaveText(/^\d+月\d+日 周. 18:30 · 还剩1天$/);

  // 没选日期时点时钟：日期默认今天
  const bar = quickAddBar(page);
  await bar.getByRole('button', { name: '选择时刻' }).click();
  await expect(dateInput(bar)).toHaveValue(localDate(0));
  await expect(timeInput(bar)).toBeVisible();
});

test('左侧菜单是唯一的筛选：状态单选 × 分类多选（命中任一即显示），页面内没有筛选标签', async ({
  page,
}) => {
  const id = runId();
  const t = (name: string) => `${id} ${name}`;
  const work = `${id}工作`;
  const home = `${id}家庭`;
  await page.goto('/');

  for (const name of [work, home]) await createCategory(page, name);
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

  // 页面内不再有分类 / 状态标签
  await expect(page.getByRole('group', { name: '分类筛选' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: '状态筛选' })).toHaveCount(0);

  // 一个分类都不选 = 所有分类
  await expectTitles(page, id, [t('无分类'), t('工作和家庭'), t('只工作')]);

  await toggleCategory(page, home);
  await expectTitles(page, id, [t('工作和家庭')]);
  await expect(page.getByTestId('page-scope')).toHaveText(home);

  // 多选累加：命中任一所选分类即显示
  await toggleCategory(page, work);
  await expectTitles(page, id, [t('工作和家庭'), t('只工作')]);

  // 与状态组合；切换状态时分类选择保持
  await selectStatus(page, '未完成');
  await expect(categoryToggle(page, work)).toHaveAttribute('aria-pressed', 'true');
  await expectTitles(page, id, [t('工作和家庭'), t('只工作')]);
  await page.getByRole('checkbox', { name: `完成：${t('只工作')}` }).click();
  await expectTitles(page, id, [t('工作和家庭')]);
  await selectStatus(page, '已完成');
  await expectTitles(page, id, [t('只工作')]);

  // 刷新后保持
  await page.reload();
  await expect(categoryToggle(page, home)).toHaveAttribute('aria-pressed', 'true');
  await expectTitles(page, id, [t('只工作')]);

  // 取消全部分类：回到所有分类
  await selectStatus(page, '全部');
  await toggleCategory(page, work);
  await toggleCategory(page, home);
  await expectTitles(page, id, [t('无分类'), t('工作和家庭'), t('只工作')]);
});

test('快速添加：自动带上当前选中的全部分类；没选分类就不带', async ({ page }) => {
  const id = runId();
  const t = (name: string) => `${id} ${name}`;
  const work = `${id}工作`;
  const home = `${id}家庭`;
  await page.goto('/');
  for (const name of [work, home]) await createCategory(page, name);
  const row = (name: string) => taskItem(page, t(name));
  const input = page.getByLabel('快速添加任务');

  // 选一个
  await toggleCategory(page, work);
  await expect(input).toHaveAttribute('placeholder', `添加到「${work}」，回车创建`);
  await quickAdd(page, t('单选'));
  await expect(row('单选')).toContainText(work);
  await expect(row('单选')).not.toContainText(home);

  // 选两个：新任务同时带上两个分类（取代原来"只选一个才自动归入"的规则）
  await toggleCategory(page, home);
  await expect(input).toHaveAttribute('placeholder', `添加到「${work}」「${home}」，回车创建`);
  await quickAdd(page, t('多选'));
  await expect(row('多选')).toContainText(work);
  await expect(row('多选')).toContainText(home);

  // 展开面板：两个分类都已预选
  await quickAddBar(page).getByRole('button', { name: '展开完整选项' }).click();
  const create = page.getByRole('form', { name: '新建任务' });
  for (const name of [work, home]) {
    await expect(create.getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }
  await create.getByRole('button', { name: '收起', exact: true }).click();

  // 都不选：不带分类
  await toggleCategory(page, work);
  await toggleCategory(page, home);
  await expect(input).toHaveAttribute('placeholder', '添加任务，回车创建');
  await quickAdd(page, t('不选'));
  await expect(row('不选')).not.toContainText(work);
  await expect(row('不选')).not.toContainText(home);

  // 刷新后仍然成立（分类关联已写入数据库）
  await page.reload();
  await expect(row('多选')).toContainText(home);
  await expect(row('单选')).not.toContainText(home);
});

test('标星：列表行与面板里都可切换；"收藏"显示所有标星任务并可配合分类；不影响排序', async ({
  page,
  request,
}) => {
  const id = runId();
  const t = (name: string) => `${id} ${name}`;
  const work = `${id}工作`;
  await page.goto('/');
  await createCategory(page, work);
  await quickAdd(page, t('后天'), { deadline: localDate(2) });
  await quickAdd(page, t('明天'), { deadline: localDate(1) });
  await quickAdd(page, t('已完成'), { deadline: localDate(3) });

  // 列表行里的星标
  const star = (name: string) =>
    taskItem(page, t(name)).getByRole('button', { name: /^(标星|取消标星)$/ });
  await star('后天').click();
  await expect(star('后天')).toHaveAttribute('aria-pressed', 'true');
  await expect(star('后天')).toHaveAccessibleName('取消标星');

  // 面板里的星标（自动保存）
  const taskId = await openTask(page, t('已完成'));
  await editPanel(page).getByRole('button', { name: '标星', exact: true }).click();
  await editPanel(page)
    .getByRole('checkbox', { name: `完成：${t('已完成')}` })
    .click();
  await waitSaved(page);
  await collapse(page);
  const [saved] = await queryRest<{ is_starred: boolean }[]>(
    request,
    `tasks?id=eq.${taskId}&select=is_starred`,
  );
  expect(saved!.is_starred).toBe(true);

  // 标星不影响排序
  await expectTitles(page, id, [t('明天'), t('后天'), t('已完成')]);

  // 收藏：所有标星任务（包括已完成的），快速添加不出现
  await selectStatus(page, '收藏');
  await expectTitles(page, id, [t('后天'), t('已完成')]);
  await expect(page.getByLabel('快速添加任务')).toHaveCount(0);

  // 收藏 + 分类
  await toggleCategory(page, work);
  await expectTitles(page, id, []);
  await toggleCategory(page, work);

  // 在收藏里取消标星：任务离开收藏
  await star('后天').click();
  await expectTitles(page, id, [t('已完成')]);
  await page.reload();
  await expectTitles(page, id, [t('已完成')]);
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

  // 旧的按状态 / 按分类地址跳转到同一页面的查询参数
  await page.goto('/list/missed');
  await expect(page).toHaveURL(/\/\?status=missed$/);
  await expect(page.getByRole('heading', { level: 1, name: '已错过' })).toBeVisible();
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
  await titleBox(editPanel(page)).fill('   ');
  await expect(editPanel(page)).toContainText('标题不能为空');
  await expect(editPanel(page)).toHaveAttribute('data-save-state', 'invalid');
  await collapse(page);

  const [row] = await queryRest<{ title: string }[]>(request, `tasks?id=eq.${taskId}&select=title`);
  expect(row!.title).toBe(`${id} 有空格`);
});

test('点任务标题：标题所在的那一行留在原位变为可编辑，面板从它下方展开', async ({
  page,
  request,
}) => {
  const id = runId();
  const title = `${id} 原位编辑`;
  await page.goto('/');
  await quickAdd(page, title);
  const item = taskItem(page, title);

  const taskId = await openTask(page, title);
  const box = titleBox(item);
  // 标题输入框就在原来那一行（同一个列表项、同一位置），面板在它下方
  await expect(box).toBeVisible();
  const titleTop = (await box.boundingBox())!.y;
  // 标题在这个列表项的最上面一行（原来标题所在的位置）
  expect(Math.abs(titleTop - (await item.boundingBox())!.y)).toBeLessThan(24);
  const surface = item.getByRole('dialog', { name: '编辑任务' });
  expect((await surface.boundingBox())!.y).toBeGreaterThan(titleTop);
  // 面板里没有第二个可见的标题栏
  await expect(editPanel(page).getByRole('textbox', { name: '标题', exact: true })).toHaveCount(1);

  await box.fill(`${title}改`);
  await waitSaved(page);
  await collapse(page);
  await expect(taskItem(page, `${title}改`)).toBeVisible();
  const [row] = await queryRest<{ title: string }[]>(request, `tasks?id=eq.${taskId}&select=title`);
  expect(row!.title).toBe(`${title}改`);
});

test('面板中勾选完成：任务在收起前留在原位，收起后离开"未完成"', async ({ page }) => {
  const id = runId();
  const title = `${id} 面板完成`;
  await page.goto('/');
  await quickAdd(page, title);
  await selectStatus(page, '未完成');
  await openTask(page, title);
  await editPanel(page)
    .getByRole('checkbox', { name: `完成：${title}` })
    .click();
  await waitSaved(page);
  await expect(editPanel(page).getByRole('checkbox', { name: `取消完成：${title}` })).toBeChecked();
  await expect(taskItem(page, title)).toBeVisible();
  await collapse(page);
  await expect(taskItem(page, title)).toHaveCount(0);
  await selectStatus(page, '已完成');
  await expect(taskItem(page, title)).toBeVisible();
});

test('侧边栏计数：状态项按所选分类计数，分类项按所选状态计数', async ({ page }) => {
  const id = runId();
  const work = `${id}工作`;
  await page.goto('/');
  await createCategory(page, work);
  await toggleCategory(page, work);
  await quickAdd(page, `${id} 一`);
  await quickAdd(page, `${id} 二`, { deadline: localDate(-1) });

  const status = (label: string) =>
    sidebar(page)
      .getByRole('region', { name: '状态' })
      .getByRole('link', { name: new RegExp(`^${label}`) });
  await expect(status('全部')).toContainText('2');
  await expect(status('未完成')).toContainText('1');
  await expect(status('已错过')).toContainText('1');
  await expect(categoryToggle(page, work)).toContainText('2');
  await selectStatus(page, '已错过');
  await expect(categoryToggle(page, work)).toContainText('1');
});
