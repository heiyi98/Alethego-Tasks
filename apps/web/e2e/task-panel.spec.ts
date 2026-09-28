import { expect, test } from '@playwright/test';

import {
  collapse,
  createPanel,
  dateInput,
  editPanel,
  localDate,
  openTask,
  pickImportance,
  queryRest,
  quickAdd,
  quickAddBar,
  runId,
  taskItem,
  titleBox,
  toast,
  waitSaved,
} from './helpers';

const expandToggle = (page: import('@playwright/test').Page) =>
  quickAddBar(page).getByRole('button', { name: '展开完整选项' });

test('展开面板新建：三角旋转、收起不丢内容（三角 / 点外面 / Esc）、对勾创建全部字段', async ({
  page,
  request,
}) => {
  const id = runId();
  const title = `${id} 完整新建`;
  await page.goto('/');

  // 快速添加栏里填的标题与选项，展开后仍在
  await page.getByLabel('快速添加任务').fill(title);
  await pickImportance(quickAddBar(page), 3);
  await dateInput(quickAddBar(page)).fill(localDate(2));

  // 三角：命中区域至少 44×44；展开后朝上（旋转 180°）
  const toggle = expandToggle(page);
  const box = (await toggle.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();

  const panel = createPanel(page);
  await expect(panel).toBeVisible();
  const collapseButton = panel.getByRole('button', { name: '收起', exact: true });
  await expect(collapseButton).toHaveAttribute('aria-expanded', 'true');
  await expect(collapseButton.locator('svg')).toHaveCSS('transform', /matrix\(-1, .*-1, 0, 0\)/);
  // 快速添加时，输入栏本身就是标题：面板从它下方延展出来，没有单独的标题栏
  await expect(panel.getByLabel('快速添加任务')).toHaveValue(title);
  await expect(panel.getByRole('textbox', { name: '标题', exact: true })).toHaveCount(0);
  const inputBox = (await panel.getByLabel('快速添加任务').boundingBox())!;
  const surfaceBox = (await panel.getByRole('dialog', { name: '新建任务' }).boundingBox())!;
  expect(surfaceBox.y).toBeGreaterThanOrEqual(inputBox.y + inputBox.height - 1);
  await expect(panel.getByRole('button', { name: '重要性 3', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(dateInput(panel)).toHaveValue(localDate(2));

  // 字段以图标为标签：只有给读屏软件的 aria-label，没有悬停提示
  for (const name of ['描述', '分类', '重复', '地点', '人物', '截止日期', '重要性']) {
    const icon = panel.locator(`.field-icon[aria-label="${name}"]`);
    await expect(icon).toHaveCount(1);
    await expect(icon).not.toHaveAttribute('title', /.*/);
  }
  // 全站没有 title 悬停提示
  await expect(page.locator('[title]')).toHaveCount(0);

  await panel.getByRole('textbox', { name: '描述' }).fill('带上身份证');
  await panel.getByLabel('地点名称').fill('市民中心');
  await panel.getByRole('button', { name: '添加人物' }).click();
  await panel.getByLabel('第 1 个人物的姓名').fill('王五');
  await panel.getByLabel('第 1 个人物的关系').fill('同事');

  // 1) 再点三角收起：内容保留
  await collapseButton.click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByLabel('快速添加任务')).toHaveValue(title);
  await expandToggle(page).click();
  await expect(panel.getByRole('textbox', { name: '描述' })).toHaveValue('带上身份证');

  // 2) 点面板外面收起
  await page.getByRole('heading', { level: 1 }).click();
  await expect(panel).toHaveCount(0);
  await expandToggle(page).click();
  await expect(panel.getByLabel('第 1 个人物的姓名')).toHaveValue('王五');

  // 3) Esc 收起
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expandToggle(page).click();
  await expect(panel.getByLabel('地点名称')).toHaveValue('市民中心');

  // 对勾：创建并收起，草稿清空
  await panel.getByRole('button', { name: '创建' }).click();
  await expect(panel).toHaveCount(0);
  await expect(taskItem(page, title)).toBeVisible();
  await expect(page.getByLabel('快速添加任务')).toHaveValue('');
  await expect(taskItem(page, title)).toContainText('重要性 3');

  const taskId = await openTask(page, title);
  await expect(editPanel(page).getByRole('textbox', { name: '描述' })).toHaveValue('带上身份证');
  await expect(editPanel(page).getByLabel('第 1 个人物的关系')).toHaveValue('同事');
  const people = await queryRest<{ name: string }[]>(request, `task_people?task_id=eq.${taskId}`);
  expect(people.map((p) => p.name)).toEqual(['王五']);
});

test('放弃新建：有内容时确认一次（可取消），空草稿直接关闭', async ({ page }) => {
  const id = runId();
  await page.goto('/');

  // 空草稿：叉直接关闭，没有确认框
  await expandToggle(page).click();
  await createPanel(page).getByRole('button', { name: '放弃' }).click();
  await expect(createPanel(page)).toHaveCount(0);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  // 有内容：确认框（图标按钮），取消后继续编辑
  await expandToggle(page).click();
  await createPanel(page).getByLabel('快速添加任务').fill(`${id} 要放弃`);
  await createPanel(page).getByRole('button', { name: '放弃' }).click();
  const dialog = page.getByRole('alertdialog', { name: '放弃这个新任务？' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '继续编辑' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(createPanel(page).getByLabel('快速添加任务')).toHaveValue(`${id} 要放弃`);

  // Esc 只关闭确认框，不收起面板
  await createPanel(page).getByRole('button', { name: '放弃' }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(createPanel(page)).toBeVisible();

  // 确认放弃：草稿清空
  await createPanel(page).getByRole('button', { name: '放弃' }).click();
  await dialog.getByRole('button', { name: '放弃' }).click();
  await expect(createPanel(page)).toHaveCount(0);
  await expect(page.getByLabel('快速添加任务')).toHaveValue('');
  await expect(taskItem(page, `${id} 要放弃`)).toHaveCount(0);
});

test('同一时间只展开一个面板；打开另一个时当前的收起（新建草稿保留）', async ({ page }) => {
  const id = runId();
  const a = `${id} 甲`;
  const b = `${id} 乙`;
  await page.goto('/');
  await quickAdd(page, a);
  await quickAdd(page, b);

  await expandToggle(page).click();
  await createPanel(page).getByLabel('快速添加任务').fill(`${id} 草稿`);

  await openTask(page, a);
  await expect(createPanel(page)).toHaveCount(0);
  await expect(page.locator('.task-editor')).toHaveCount(1);

  await openTask(page, b);
  await expect(page.locator('.task-editor')).toHaveCount(1);
  await expect(taskItem(page, a)).not.toHaveClass(/task-item-open/);

  // 点三角收起
  await page.getByRole('button', { name: '收起', exact: true }).click();
  await expect(page.locator('.task-editor')).toHaveCount(0);
  await expect(page.getByLabel('快速添加任务')).toHaveValue(`${id} 草稿`);
});

test('编辑自动保存：地点与多个人物；删除人物与清空描述不确认，提示条可撤销', async ({
  page,
  request,
}) => {
  const id = runId();
  const title = `${id} 签合同`;
  await page.goto('/');
  await quickAdd(page, title);
  const taskId = await openTask(page, title);
  const panel = editPanel(page);

  // 编辑面板没有保存 / 还原按钮
  await expect(panel.getByRole('button', { name: /保存|还原/ })).toHaveCount(0);

  await panel.getByRole('textbox', { name: '描述' }).fill('带两份合同');
  await panel.getByLabel('地点名称').fill('客户公司');
  await panel.getByLabel('地址').fill('人民路 1 号');
  await panel.getByRole('button', { name: '添加人物' }).click();
  await panel.getByLabel('第 1 个人物的姓名').fill('张三');
  await panel.getByLabel('第 1 个人物的关系').fill('客户');
  await panel.getByRole('button', { name: '添加人物' }).click();
  await panel.getByLabel('第 2 个人物的姓名').fill('李四');
  await panel.getByRole('button', { name: '添加人物' }).click(); // 空行保存时被忽略
  await waitSaved(page);

  // 刷新后读回
  await page.reload();
  await openTask(page, title);
  await expect(panel.getByRole('textbox', { name: '描述' })).toHaveValue('带两份合同');
  await expect(panel.getByLabel('地点名称')).toHaveValue('客户公司');
  await expect(panel.getByLabel('第 1 个人物的姓名')).toHaveValue('张三');
  await expect(panel.getByLabel('第 2 个人物的姓名')).toHaveValue('李四');
  await expect(panel.getByLabel('第 3 个人物的姓名')).toHaveCount(0);

  const [location] = await queryRest<Record<string, unknown>[]>(
    request,
    `task_locations?task_id=eq.${taskId}`,
  );
  expect(location).toMatchObject({ name: '客户公司', place_id: null, lat: null, lng: null });
  const people = await queryRest<{ id: string; name: string }[]>(
    request,
    `task_people?task_id=eq.${taskId}&order=created_at`,
  );
  expect(people.map((p) => p.name)).toEqual(['张三', '李四']);

  // 只填关系不填姓名 → 提示错误，人物不写入
  await panel.getByRole('button', { name: '添加人物' }).click();
  await panel.getByLabel('第 3 个人物的关系').fill('同事');
  await expect(panel).toContainText('第 3 个人物缺少姓名');
  await panel.getByRole('button', { name: '删除第 3 个人物' }).click();
  await expect(toast(page, '已删除人物「同事」')).toBeVisible();

  // 删除李四：不确认，提示条可撤销
  await panel.getByRole('button', { name: '删除第 2 个人物' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(panel.getByLabel('第 2 个人物的姓名')).toHaveCount(0);
  const removed = toast(page, '已删除人物「李四」');
  await expect(removed).toBeVisible();
  await waitSaved(page);
  expect((await queryRest<unknown[]>(request, `task_people?task_id=eq.${taskId}`)).length).toBe(1);
  await removed.getByRole('button', { name: '撤销' }).click();
  await expect(panel.getByLabel('第 2 个人物的姓名')).toHaveValue('李四');
  await waitSaved(page);

  // 清空描述：不确认，提示条可撤销
  await panel.getByRole('textbox', { name: '描述' }).fill('');
  const cleared = toast(page, '已清空描述');
  await expect(cleared).toBeVisible();
  await cleared.getByRole('button', { name: '撤销' }).click();
  await expect(panel.getByRole('textbox', { name: '描述' })).toHaveValue('带两份合同');
  await waitSaved(page);
  await collapse(page);

  await page.reload();
  await openTask(page, title);
  await expect(panel.getByRole('textbox', { name: '描述' })).toHaveValue('带两份合同');
  await expect(panel.getByLabel('第 2 个人物的姓名')).toHaveValue('李四');
  const after = await queryRest<{ name: string }[]>(
    request,
    `task_people?task_id=eq.${taskId}&order=created_at`,
  );
  expect(after.map((p) => p.name)).toEqual(['张三', '李四']);

  // 清空地点：自动保存后删除记录
  await panel.getByLabel('地点名称').fill('');
  await panel.getByLabel('地址').fill('');
  await waitSaved(page);
  expect(await queryRest<unknown[]>(request, `task_locations?task_id=eq.${taskId}`)).toEqual([]);
});

test('收起时立即保存尚未提交的改动', async ({ page, request }) => {
  const id = runId();
  const title = `${id} 收起即保存`;
  await page.goto('/');
  await quickAdd(page, title);
  const taskId = await openTask(page, title);
  await titleBox(editPanel(page)).fill(`${title}！`);
  // 不等防抖，直接按 Esc 收起
  await page.keyboard.press('Escape');
  await expect(taskItem(page, `${title}！`)).toBeVisible();
  await expect
    .poll(async () => {
      const [row] = await queryRest<{ title: string }[]>(
        request,
        `tasks?id=eq.${taskId}&select=title`,
      );
      return row?.title;
    })
    .toBe(`${title}！`);
});

test('手机：面板为底部抽屉，点背景或下滑收起', async ({ page }) => {
  const id = runId();
  const title = `${id} 手机`;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await quickAdd(page, title);
  await openTask(page, title);

  const surface = page.getByRole('dialog', { name: '编辑任务' });
  // 贴底、占满宽度（等抽屉的滑入动画结束）
  const expectDocked = () =>
    expect
      .poll(async () => {
        const box = (await surface.boundingBox())!;
        return [Math.round(box.y + box.height), Math.round(box.width)];
      })
      .toEqual([844, 390]);
  await expectDocked();
  // 抽屉顶部自带一行可编辑的标题（列表行在遮罩后面）
  await expect(titleBox(surface)).toBeVisible();
  await expect(titleBox(surface)).toHaveValue(title);

  // 点背景遮罩收起
  await page.mouse.click(195, 40);
  await expect(surface).toHaveCount(0);

  // 下滑把手收起
  await openTask(page, title);
  await expectDocked();
  const handle = surface.locator('.sheet-handle');
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2, h.y + 60, { steps: 4 });
  await page.mouse.move(h.x + h.width / 2, h.y + 160, { steps: 4 });
  await page.mouse.up();
  await expect(surface).toHaveCount(0);
});
