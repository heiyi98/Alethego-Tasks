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
  scopeItem,
  selectScope,
  selectStatus,
  setTime,
  sidebar,
  statusBar,
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
  // 默认：总览（没有选任何分类），页面内状态行默认"未完成"，状态行在添加栏下面
  await expect(page.getByRole('heading', { level: 1, name: '总览' })).toBeVisible();
  await expect(statusBar(page).getByRole('button', { name: '未完成' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const barBox = (await quickAddBar(page).boundingBox())!;
  expect((await statusBar(page).boundingBox())!.y).toBeGreaterThan(barBox.y + barBox.height - 1);
  // 状态已不在左侧菜单里
  await expect(sidebar(page).getByRole('region', { name: '状态' })).toHaveCount(0);
  await selectStatus(page, '全部');

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

  // 未完成：已过期的不在其中；添加栏每个状态下都有
  await selectStatus(page, '未完成');
  await expectTitles(page, id, [t('明天'), t('下周'), t('无截止')]);
  await expect(page.getByLabel('快速添加任务')).toBeVisible();

  await selectStatus(page, '已错过');
  await expectTitles(page, id, [t('已过期')]);
  await expect(page.getByLabel('快速添加任务')).toBeVisible();

  // 完成任务后离开未完成，出现在已完成
  await selectStatus(page, '未完成');
  // 未完成视图中勾选后任务立即离开列表，因此用 click 而不是 check
  await page.getByRole('checkbox', { name: `完成：${t('明天')}` }).click();
  await expect(taskItem(page, t('明天'))).toHaveCount(0);
  await selectStatus(page, '已完成');
  await expectTitles(page, id, [t('明天')]);

  // 在"已完成"里新建：任务创建成功但看不见（未完成），不做任何自动切换
  await quickAdd(page, t('在已完成里新建'), { expectVisible: false });
  await expect(taskItem(page, t('在已完成里新建'))).toHaveCount(0);
  await expect(statusBar(page).getByRole('button', { name: '已完成' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

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
  const order = [t('已过期'), t('明天'), t('无截止'), t('下周'), t('在已完成里新建')];
  await expectTitles(page, id, order);
  await page.reload();
  await expectTitles(page, id, order);
});

test('具体时刻：没选时刻过完当天才算错过，选了时刻过了那一刻就算错过', async ({
  page,
  request,
}) => {
  const id = runId();
  const t = (name: string) => `${id} ${name}`;
  await page.goto('/');
  await selectStatus(page, '全部');

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

test('筛选：范围 × 分类多选（命中任一即显示）× 页面内状态行；页面内没有分类标签', async ({
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
  await expect(page.getByTestId('title-capsule')).toHaveText([home]);

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

test('快速添加：左边没有图标，右端 ➕ 创建（回车是额外的快捷方式）；输入栏这一行展开详情前后完全不变', async ({
  page,
}) => {
  const id = runId();
  await page.goto('/');
  const input = page.getByLabel('快速添加任务');
  const row = page.locator('.quick-add-input');
  const create = row.getByRole('button', { name: '创建', exact: true });
  await expect(create).toBeVisible();
  await expect(create).toHaveClass(/icon-button-primary/);
  // ➕ 图标，不是 ✓；输入栏左边没有 + 图标
  await expect(create.locator('svg path')).toHaveAttribute('d', 'M12 5v14M5 12h14');
  await expect(page.locator('.quick-add-plus')).toHaveCount(0);
  await expect(row.locator('svg')).toHaveCount(1);

  await input.fill(`${id} 点加号`);
  await create.click();
  await expect(input).toHaveValue('');
  await expect(taskItem(page, `${id} 点加号`)).toBeVisible();

  await input.fill(`${id} 按回车`);
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(taskItem(page, `${id} 按回车`)).toBeVisible();

  // 空白标题：点 ➕ 不创建
  await input.fill('   ');
  await create.click();
  await expect(input).toHaveValue('   ');
  await input.fill('');

  // 展开详情：输入栏这一行是同一个元素，尺寸、图标位置和大小都不变；详情挂在它下方
  const measure = () =>
    Promise.all([
      row.boundingBox(),
      input.boundingBox(),
      create.boundingBox(),
      create.locator('svg').boundingBox(),
    ]);
  await row.evaluate((el) => ((el as HTMLElement).dataset.probe = 'same'));
  const before = await measure();
  await quickAddBar(page).getByRole('button', { name: '展开完整选项' }).click();
  await expect(page.getByRole('form', { name: '新建任务' })).toBeVisible();
  await expect(row).toHaveAttribute('data-probe', 'same');
  expect(await measure()).toEqual(before);
  await expect(create.locator('svg path')).toHaveAttribute('d', 'M12 5v14M5 12h14');
  const detail = (await page.getByRole('dialog', { name: '新建任务' }).boundingBox())!;
  expect(detail.y).toBeGreaterThanOrEqual(before[0]!.y + before[0]!.height - 1);
  // 点输入栏不会收起展开的详情
  await input.click();
  await expect(page.getByRole('form', { name: '新建任务' })).toBeVisible();
  await page
    .getByRole('form', { name: '新建任务' })
    .getByRole('button', { name: '收起', exact: true })
    .click();
  expect(await measure()).toEqual(before);

  // 已经存在的任务正在编辑：右侧是 ✓，点它保存并收起
  await quickAdd(page, `${id} 已存在`);
  await openTask(page, `${id} 已存在`);
  const done = editPanel(page).getByRole('button', { name: '完成编辑' });
  await expect(done.locator('svg path')).toHaveAttribute('d', 'M5 12.5l4.5 4.5L19 7.5');
  await titleBox(editPanel(page)).fill(`${id} 已存在改`);
  await done.click();
  await expect(editPanel(page)).toHaveCount(0);
  await expect(taskItem(page, `${id} 已存在改`)).toBeVisible();
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

  // 输入栏不显示占位提示文字
  await expect(input).not.toHaveAttribute('placeholder', /.*/);

  // 选一个
  await toggleCategory(page, work);
  await expect(input).not.toHaveAttribute('placeholder', /.*/);
  await quickAdd(page, t('单选'));
  await expect(row('单选')).toContainText(work);
  await expect(row('单选')).not.toContainText(home);

  // 选两个：新任务同时带上两个分类（取代原来"只选一个才自动归入"的规则）
  await toggleCategory(page, home);
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
  await quickAdd(page, t('不选'));
  await expect(row('不选')).not.toContainText(work);
  await expect(row('不选')).not.toContainText(home);

  // 刷新后仍然成立（分类关联已写入数据库）
  await page.reload();
  await expect(row('多选')).toContainText(home);
  await expect(row('单选')).not.toContainText(home);
});

test('标星：列表行与面板里都可切换；范围"收藏"= 标星任务，可配合分类与状态；在收藏里新建自动标星', async ({
  page,
  request,
}) => {
  const id = runId();
  const t = (name: string) => `${id} ${name}`;
  const work = `${id}工作`;
  await page.goto('/');
  await createCategory(page, work);
  await selectStatus(page, '全部');
  await quickAdd(page, t('后天'), { deadline: localDate(2) });
  await quickAdd(page, t('明天'), { deadline: localDate(1) });
  await quickAdd(page, t('已完成'), { deadline: localDate(3) });

  // 列表行里的星标：未标星的也一直显示（空心星），不靠悬停
  const star = (name: string) =>
    taskItem(page, t(name)).getByRole('button', { name: /^(标星|取消标星)$/ });
  await page.mouse.move(0, 0);
  await expect(star('明天')).toBeVisible();
  await expect(star('明天')).toHaveCSS('opacity', '1');
  await expect(star('明天')).toHaveAttribute('aria-pressed', 'false');
  await expect(star('明天').locator('svg')).toHaveAttribute('fill', 'none');
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
  await selectStatus(page, '全部');
  await expectTitles(page, id, [t('明天'), t('后天'), t('已完成')]);

  // 范围"收藏"：标星任务 ∩ 状态（状态行照常可选）
  await selectScope(page, '收藏');
  await expectTitles(page, id, [t('后天'), t('已完成')]);
  await selectStatus(page, '未完成');
  await expectTitles(page, id, [t('后天')]);
  await selectStatus(page, '已完成');
  await expectTitles(page, id, [t('已完成')]);
  await selectStatus(page, '全部');

  // 在"收藏"里也有添加栏，新建的任务自动标星
  await expect(quickAddBar(page).getByRole('button', { name: '取消标星' })).toHaveCount(0);
  await quickAdd(page, t('收藏里新建'), { deadline: localDate(5) });
  await expect(star('收藏里新建')).toHaveAttribute('aria-pressed', 'true');
  await expectTitles(page, id, [t('后天'), t('已完成'), t('收藏里新建')]);

  // 收藏 + 分类
  await toggleCategory(page, work);
  await expectTitles(page, id, []);
  await toggleCategory(page, work);

  // 在收藏里取消标星：任务离开收藏
  await star('后天').click();
  await expectTitles(page, id, [t('已完成'), t('收藏里新建')]);
  await page.reload();
  await expectTitles(page, id, [t('已完成'), t('收藏里新建')]);

  // 回到"总览"：新建的任务不自动标星
  await selectScope(page, '总览');
  await quickAdd(page, t('总览里新建'));
  await expect(star('总览里新建')).toHaveAttribute('aria-pressed', 'false');
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

  // 旧的 /tasks/[id] 详情页和独立的历史页都已移除（历史嵌在展开面板里）
  const old = await page.goto(`/tasks/${taskId}`);
  expect(old?.status()).toBe(404);
  const history = await page.goto(`/tasks/${taskId}/history`);
  expect(history?.status()).toBe(404);

  // 旧地址自动兼容跳转
  await page.goto('/list/missed');
  await expect(page).toHaveURL(/\/\?status=missed$/);
  await expect(statusBar(page).getByRole('button', { name: '已错过' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // 以前"收藏"是一种状态：?status=starred → 范围"收藏"
  await page.goto('/?status=starred');
  await expect(page).toHaveURL(/\/\?scope=starred$/);
  await expect(page.getByRole('heading', { level: 1, name: '收藏' })).toBeVisible();
  await page.goto('/list/starred');
  await expect(page).toHaveURL(/\/\?scope=starred$/);
  await page.goto('/matrix?status=starred');
  await expect(page).toHaveURL(/\/matrix\?scope=starred$/);
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

test('左侧菜单的数字：按页面当前的状态计数；总览不分分类，收藏与分类项在当前选择内计数', async ({
  page,
}) => {
  const id = runId();
  const work = `${id}工作`;
  await page.goto('/');
  await createCategory(page, work);
  await selectStatus(page, '全部');
  const count = (locator: ReturnType<typeof scopeItem>) => locator.locator('.sidebar-count');
  const overviewBefore = Number(await count(scopeItem(page, '总览')).textContent());

  await toggleCategory(page, work);
  await quickAdd(page, `${id} 一`);
  await quickAdd(page, `${id} 二`, { deadline: localDate(-1) });
  await taskItem(page, `${id} 一`).getByRole('button', { name: '标星', exact: true }).click();

  // 总览 = 没有选任何分类：数的是全部任务（这里新增了 2 个）
  await expect(count(scopeItem(page, '总览'))).toHaveText(String(overviewBefore + 2));
  // 收藏在所选分类内计数；分类项在当前范围内计数
  await expect(count(scopeItem(page, '收藏'))).toHaveText('1');
  await expect(count(categoryToggle(page, work))).toHaveText('2');

  // 状态"已错过"：数字跟着变
  await selectStatus(page, '已错过');
  await expect(count(scopeItem(page, '收藏'))).toHaveText('0');
  await expect(count(categoryToggle(page, work))).toHaveText('1');

  // 范围"收藏"：分类项只数标星的
  await selectStatus(page, '全部');
  await selectScope(page, '收藏');
  await expect(count(categoryToggle(page, work))).toHaveText('1');
});

test('标题栏：总览 / 分类胶囊（名字不能点，只有 ✕ 取消）/ 收藏；高度固定，胶囊再多也不把下方内容顶下去', async ({
  page,
}) => {
  const id = runId();
  const names = [1, 2, 3, 4, 5, 6].map((n) => `${id}很长的分类名称${n}`);
  await page.goto('/');
  for (const name of names) await createCategory(page, name);
  const bar = page.getByRole('heading', { level: 1 });
  await expect(bar).toHaveText('总览');
  const rowHeight = (await bar.boundingBox())!.height;
  const statusY = async () => (await statusBar(page).boundingBox())!.y;
  const baseY = await statusY();

  // 选一个分类：标题变成胶囊，栏数不变，下方内容不动
  await toggleCategory(page, names[0]!);
  await expect(page.getByTestId('title-capsule')).toHaveText([names[0]!]);
  await expect(bar).not.toContainText('总览');
  expect(await statusY()).toBe(baseY);

  // 胶囊放不下时在同一行里左右滑动：标题行高度不变，下方内容不动
  for (const name of names.slice(1)) {
    await toggleCategory(page, name);
    expect((await bar.boundingBox())!.height).toBe(rowHeight);
    expect(await statusY()).toBe(baseY);
  }
  expect(await bar.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

  // 点 ✕ 取消这个分类的选择
  await page.getByRole('button', { name: `取消选择「${names[5]}」` }).click();
  await expect(page.getByTestId('title-capsule')).toHaveCount(5);
  await expect(page.locator('main')).not.toContainText(names[5]!);

  // 胶囊上的名字不能点：没有按钮，点了什么都不发生（编辑分类只走侧边栏的铅笔）
  const capsule = page.getByTestId('title-capsule').filter({ hasText: names[0]! });
  await expect(capsule.getByRole('button')).toHaveCount(1);
  await capsule.locator('.title-capsule-name').click();
  await expect(page.getByRole('main').getByRole('form', { name: /编辑分类/ })).toHaveCount(0);
  expect(await statusY()).toBe(baseY);
  await expect(capsule).not.toHaveAttribute('title', /.*/);

  // 收藏：标题永远只显示"收藏"，分类筛选照常生效，侧边栏开关保持高亮
  await selectScope(page, '收藏');
  await expect(bar).toHaveText('收藏');
  await expect(page.getByTestId('title-capsule')).toHaveCount(0);
  await expect(categoryToggle(page, names[0]!)).toHaveAttribute('aria-pressed', 'true');

  // 点总览：清空所有分类选择
  await selectScope(page, '总览');
  await expect(bar).toHaveText('总览');
  await expect(categoryToggle(page, names[0]!)).toHaveAttribute('aria-pressed', 'false');
  await expect(page).not.toHaveURL(/cat=/);
});

test('点任务名：展开并让标题进入编辑；点行内其他区域：只展开', async ({ page }) => {
  const id = runId();
  const title = `${id} 点击行为`;
  await page.goto('/');
  await quickAdd(page, title, { deadline: localDate(2) });

  // 点行内其他区域（截止时间那一行）：只展开，不进入标题编辑
  await taskItem(page, title).locator('.task-deadline').click();
  await expect(taskItem(page, title)).toHaveClass(/task-item-open/);
  await expect(titleBox(editPanel(page))).not.toBeFocused();
  await collapse(page);

  // 点任务名：展开，同时标题获得光标
  await taskItem(page, title).locator('.task-title').click();
  await expect(titleBox(editPanel(page))).toBeFocused();
  await collapse(page);

  // 勾选框和星标不会展开
  await taskItem(page, title).getByRole('button', { name: '标星', exact: true }).click();
  await expect(taskItem(page, title)).not.toHaveClass(/task-item-open/);
});

test('展开面板没有外框：添加栏与任务行下方直接铺开字段', async ({ page }) => {
  const id = runId();
  const title = `${id} 无外框`;
  await page.goto('/');
  await quickAdd(page, title);
  await openTask(page, title);
  const surface = taskItem(page, title).locator('.panel-surface');
  await expect(surface).toHaveCSS('box-shadow', 'none');
  await expect(surface).toHaveCSS('border-top-left-radius', '0px');
  await collapse(page);

  await quickAddBar(page).getByRole('button', { name: '展开完整选项' }).click();
  const create = page.locator('.quick-add .panel-surface');
  await expect(create).toHaveCSS('box-shadow', 'none');
  await expect(create).toHaveCSS('border-top-left-radius', '0px');
});
