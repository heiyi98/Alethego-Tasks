import { expect, test, type Page } from '@playwright/test';

import {
  createCategory,
  editPanel,
  localDate,
  pickImportance,
  quickAdd,
  runId,
  selectStatus,
  sidebar,
  switchMode,
  taskItem,
  titleBox,
  toggleCategory,
  waitSaved,
} from './helpers';

const dot = (page: Page, title: string) => page.locator(`.matrix-node[aria-label^="${title}，"]`);

test('矩阵：按紧迫度 × 重要性放置，逾期贴边，远期与未处理不显示，象限列表，点击弹出编辑面板', async ({
  page,
}) => {
  const id = runId();
  const t = (name: string) => `${id} ${name}`;
  const category = `${id}矩阵`;

  // 选中本用例的分类后快速添加：自动带上该分类，并直接带上截止日期与重要性
  await page.goto('/');
  await createCategory(page, category);
  await toggleCategory(page, category);

  const specs = [
    { name: '明天重要', deadline: localDate(1), importance: 5 },
    { name: '下月不重要', deadline: localDate(30), importance: 1 },
    { name: '无截止重要', importance: 4 },
    { name: '逾期两天', deadline: localDate(-2), importance: 2 },
    { name: '远期', deadline: localDate(500), importance: 3 },
    { name: '未处理' },
  ];
  for (const { name, ...options } of specs) await quickAdd(page, t(name), options);

  // LOGO 右边的图标按钮切到矩阵；分类选择沿用；矩阵页内没有分类标签
  await switchMode(page, 'matrix');
  await expect(page).toHaveURL(/cat=/);
  await expect(page.getByRole('group', { name: '分类筛选' })).toHaveCount(0);
  await expect(sidebar(page).getByRole('link', { name: '切换到清单' })).toBeVisible();

  await expect(page.locator('.matrix-node')).toHaveCount(4);

  // Y 轴：重要性 0–5 是六个等宽区间，刻度画在区间边界 0–6 上
  await expect(page.getByTestId('matrix-y-tick')).toHaveText(['0', '1', '2', '3', '4', '5', '6']);

  // 任务节点显示标题文字（过长时截断），完整标题在提示中
  await expect(dot(page, t('明天重要')).locator('.node-title')).toContainText(id.slice(0, 5));
  await expect(dot(page, t('明天重要'))).toHaveAttribute('data-quadrant', 'important_urgent');
  await expect(dot(page, t('明天重要'))).toHaveAttribute('data-column', '12');
  await expect(dot(page, t('明天重要'))).toHaveAttribute('data-row', '5');
  await expect(dot(page, t('下月不重要'))).toHaveAttribute(
    'data-quadrant',
    'not_important_not_urgent',
  );
  await expect(dot(page, t('无截止重要'))).toHaveAttribute('data-quadrant', 'important_not_urgent');
  await expect(dot(page, t('无截止重要'))).toHaveAttribute('data-column', '0');

  const overdue = dot(page, t('逾期两天'));
  await expect(overdue).toHaveAttribute('data-column', '14');
  await expect(overdue).toHaveAttribute('data-quadrant', 'not_important_urgent');
  await expect(overdue).toContainText('逾期2天');
  // 逾期：点位在最右侧，标题在点位左边
  const point = (await overdue.locator('.overdue-point').boundingBox())!;
  const pill = (await overdue.locator('.node-body').boundingBox())!;
  expect(pill.x + pill.width).toBeLessThanOrEqual(point.x);
  const strip = (await page.locator('.matrix-overdue-strip').boundingBox())!;
  expect(point.x).toBeGreaterThanOrEqual(strip.x);

  await expect(page.getByTestId('matrix-hidden')).toContainText('1 个未设置重要性和截止时间');
  await expect(page.getByTestId('matrix-hidden')).toContainText('1 个截止时间超过一年');

  // 象限列表（表格视图）
  const quadrant = (name: string) => page.getByRole('region', { name, exact: true });
  await expect(quadrant('重要且紧急')).toContainText(t('明天重要'));
  await expect(quadrant('重要不紧急')).toContainText(t('无截止重要'));
  await expect(quadrant('紧急不重要')).toContainText(t('逾期两天'));
  await expect(quadrant('不重要不紧急')).toContainText(t('下月不重要'));

  // 悬停提示
  await dot(page, t('明天重要')).hover();
  await expect(page.getByRole('tooltip')).toContainText(t('明天重要'));
  await expect(page.getByRole('tooltip')).toContainText('重要性 5');
  await expect(page.getByRole('tooltip')).toContainText(category);

  // 点击任务：原页面上弹出编辑面板，不跳转
  const url = page.url();
  await dot(page, t('明天重要')).click();
  const dialog = page.getByRole('dialog', { name: '编辑任务' });
  await expect(dialog).toBeVisible();
  // 矩阵弹出的面板没有列表行可以延展，顶部自带一行可编辑的标题
  await expect(titleBox(dialog)).toBeVisible();
  await expect(titleBox(dialog)).toHaveValue(t('明天重要'));
  expect(page.url()).toBe(url);

  // 在面板里改重要性：自动保存，矩阵上的位置随之变化
  await pickImportance(editPanel(page), 1);
  await waitSaved(page);
  await expect(dot(page, t('明天重要'))).toHaveAttribute('data-row', '1');
  await expect(dot(page, t('明天重要'))).toHaveAttribute('data-quadrant', 'not_important_urgent');

  // Esc 收起；点背景遮罩也收起
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await dot(page, t('下月不重要')).click();
  await expect(titleBox(dialog)).toHaveValue(t('下月不重要'));
  await page.mouse.click(5, 5);
  await expect(dialog).toHaveCount(0);

  // 象限列表中的任务在原地展开
  await quadrant('紧急不重要').getByText(t('明天重要'), { exact: true }).click();
  await expect(quadrant('紧急不重要').getByRole('form', { name: '编辑任务' })).toBeVisible();
});

test('矩阵：完成任务后从矩阵消失；分类未命中时不显示', async ({ page }) => {
  const id = runId();
  const title = `${id} 待完成`;
  const other = `${id}其他`;
  await page.goto('/');
  await createCategory(page, other);
  await quickAdd(page, title, { deadline: localDate(2), importance: 3 });

  await switchMode(page, 'matrix');
  await expect(dot(page, title)).toHaveCount(1);

  // 选中一个该任务不属于的分类 → 不显示
  await toggleCategory(page, other);
  await expect(dot(page, title)).toHaveCount(0);
  await toggleCategory(page, other);

  await switchMode(page, 'list');
  await page.getByRole('checkbox', { name: `完成：${title}` }).click();
  await expect(taskItem(page, title)).toHaveClass(/task-completed/);
  await switchMode(page, 'matrix');
  await expect(page.getByRole('img', { name: /时间管理矩阵/ })).toBeVisible();
  await expect(dot(page, title)).toHaveCount(0);
});

test('矩阵模式与左侧状态：已完成 / 已错过切回清单；收藏只显示标星；全部与未完成相同', async ({
  page,
}) => {
  const id = runId();
  const t = (name: string) => `${id} ${name}`;
  const category = `${id}状态`;
  await page.goto('/');
  await createCategory(page, category);
  await toggleCategory(page, category);
  await quickAdd(page, t('标星'), { deadline: localDate(2), importance: 4 });
  await quickAdd(page, t('普通'), { deadline: localDate(3), importance: 2 });
  await taskItem(page, t('标星')).getByRole('button', { name: '标星', exact: true }).click();
  await expect(taskItem(page, t('标星')).getByRole('button', { name: '取消标星' })).toBeVisible();

  await switchMode(page, 'matrix');
  await expect(page.locator('.matrix-node')).toHaveCount(2);
  await selectStatus(page, '未完成');
  await expect(page).toHaveURL(/\/matrix\?status=todo/);
  await expect(page.locator('.matrix-node')).toHaveCount(2);

  // 收藏：只显示标星任务；标星不改变它在矩阵上的位置
  await selectStatus(page, '收藏');
  await expect(page.locator('.matrix-node')).toHaveCount(1);
  await expect(dot(page, t('标星'))).toHaveAttribute('data-row', '4');
  await expect(page.getByRole('region', { name: '重要且紧急', exact: true })).toContainText(
    t('标星'),
  );
  await expect(page.getByRole('region', { name: '紧急不重要', exact: true })).not.toContainText(
    t('普通'),
  );

  // 已完成：矩阵上没有对应内容，自动切回清单并显示对应列表
  await selectStatus(page, '已完成');
  await expect(page).toHaveURL(/localhost:\d+\/\?status=completed/);
  await expect(sidebar(page).getByRole('link', { name: '切换到矩阵' })).toBeVisible();
  await expect(page.getByRole('list', { name: '任务列表' })).toHaveCount(0);

  await switchMode(page, 'matrix');
  await selectStatus(page, '已错过');
  await expect(page).toHaveURL(/localhost:\d+\/\?status=missed/);

  // 直接访问矩阵的已完成地址，也会切回清单
  await page.goto('/matrix?status=completed');
  await expect(page).toHaveURL(/localhost:\d+\/\?status=completed/);
});

test('矩阵：当天已过截止时刻的任务贴在逾期列，标"今天已过"', async ({ page }) => {
  const id = runId();
  const title = `${id} 零点截止`;
  const category = `${id}今天`;
  await page.goto('/');
  await createCategory(page, category);
  await toggleCategory(page, category);
  // 今天 00:00 已经过去（除非恰好在午夜运行）
  await quickAdd(page, title, { deadline: localDate(0), time: '00:00', importance: 3 });
  await switchMode(page, 'matrix');
  await expect(dot(page, title)).toHaveAttribute('data-column', '14');
  await expect(dot(page, title)).toContainText('今天已过');
});
