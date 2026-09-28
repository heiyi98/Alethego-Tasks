import { expect, test, type Page } from '@playwright/test';

import {
  createCategory,
  editPanel,
  localDate,
  pickImportance,
  quickAdd,
  runId,
  selectScope,
  selectStatus,
  sidebar,
  statusBar,
  switchMode,
  taskItem,
  titleBox,
  toggleCategory,
  waitSaved,
} from './helpers';

const dot = (page: Page, title: string) => page.locator(`.matrix-node[aria-label^="${title}，"]`);

test('矩阵：14 格等宽标尺、刻度在分界线上、按紧迫度 × 重要性放置，远期与未处理不显示，点击弹出编辑面板', async ({
  page,
}) => {
  const id = runId();
  const t = (name: string) => `${id} ${name}`;
  const category = `${id}矩阵`;

  // 选中本用例的分类后快速添加：自动带上该分类，并直接带上截止日期与重要性
  await page.goto('/');
  await createCategory(page, category);
  await toggleCategory(page, category);
  await selectStatus(page, '全部');

  const specs = [
    { name: '明天重要', deadline: localDate(1), importance: 5 },
    { name: '下月不重要', deadline: localDate(30), importance: 1 },
    { name: '无截止重要', importance: 4 },
    { name: '前两日截止', deadline: localDate(-2), importance: 2 },
    { name: '远期', deadline: localDate(500), importance: 3 },
    { name: '未处理' },
  ];
  for (const { name, ...options } of specs) await quickAdd(page, t(name), options);

  // LOGO 右边的图标按钮切到矩阵；分类选择沿用；矩阵页没有分类标签、状态行和添加栏
  await switchMode(page, 'matrix');
  await expect(page).toHaveURL(/cat=/);
  await expect(page.getByRole('group', { name: '分类筛选' })).toHaveCount(0);
  await expect(statusBar(page)).toHaveCount(0);
  await expect(page.getByLabel('快速添加任务')).toHaveCount(0);
  await expect(sidebar(page).getByRole('link', { name: '切换到清单' })).toBeVisible();

  await expect(page.locator('.matrix-node')).toHaveCount(4);

  // Y 轴：刻度 0–5 标在分界线上，顶端没有"6"
  await expect(page.getByTestId('matrix-y-tick')).toHaveText(['0', '1', '2', '3', '4', '5']);

  // X 轴：刻度名在分界线上，从左到右；最右格（逾期区）不写字
  await expect(page.getByTestId('matrix-x-tick')).toHaveText([
    '一年',
    '三个季度',
    '半年',
    '一季度',
    '两个月',
    '一个月',
    '三周',
    '两周',
    '一周',
    '5天',
    '3天',
    '2天',
    '1天',
  ]);
  // 矩阵图里只允许出现四种文字：X 轴刻度名、Y 轴刻度数字、四个方位字、任务标题
  const nonTaskTexts = await page
    .locator('svg.matrix > text, svg.matrix > g:not(.matrix-node) text')
    .allTextContents();
  expect(nonTaskTexts.sort()).toEqual(
    [
      ...['一年', '三个季度', '半年', '一季度', '两个月', '一个月', '三周', '两周', '一周'],
      ...['5天', '3天', '2天', '1天', '0', '1', '2', '3', '4', '5'],
      ...['不紧急', '紧急', '重要', '不重要'],
    ].sort(),
  );
  // 14 格等宽：相邻分界线间距相同；中线落在"两周"上，左右各 7 格
  const xs = await page
    .getByTestId('matrix-x-tick')
    .locator('line')
    .evaluateAll((lines) => lines.map((l) => Number(l.getAttribute('x1'))));
  const widths = xs.slice(1).map((x, i) => x - xs[i]!);
  for (const w of widths) expect(w).toBeCloseTo(widths[0]!, 5);
  const midX = xs[7]!;
  const divider = await page
    .locator('.matrix-divider')
    .first()
    .evaluate((l) => Number(l.getAttribute('x1')));
  expect(divider).toBeCloseTo(midX, 5);
  const overdueX = await page
    .locator('.matrix-overdue-strip')
    .evaluate((r) => Number(r.getAttribute('x')) + Number(r.getAttribute('width')));
  expect((overdueX - midX) / widths[0]!).toBeCloseTo(7, 5);
  expect((midX - xs[0]!) / widths[0]!).toBeCloseTo(7, 5);

  // 明天：N = 2 → "2天–1天"那一格（右数第三格）；标题在格内放不下时截短，完整标题在悬停提示里
  await expect(dot(page, t('明天重要')).locator('.node-title')).toContainText(id.slice(0, 3));
  await expect(dot(page, t('明天重要'))).toHaveAttribute('data-quadrant', 'important_urgent');
  await expect(dot(page, t('明天重要'))).toHaveAttribute('data-column', '11');
  await expect(dot(page, t('明天重要'))).toHaveAttribute('data-row', '5');
  // 30 天后：N = 31 → 31–60 那一格，不紧急
  await expect(dot(page, t('下月不重要'))).toHaveAttribute('data-column', '4');
  await expect(dot(page, t('下月不重要'))).toHaveAttribute(
    'data-quadrant',
    'not_important_not_urgent',
  );
  await expect(dot(page, t('无截止重要'))).toHaveAttribute('data-quadrant', 'important_not_urgent');
  await expect(dot(page, t('无截止重要'))).toHaveAttribute('data-column', '0');

  // 逾期：最右格的第三条道；只有一个点位，在标签内部右端，标题在点位左边；标签里没有天数字样
  const overdue = dot(page, t('前两日截止'));
  await expect(overdue).toHaveAttribute('data-column', '13');
  await expect(overdue).toHaveAttribute('data-overdue-lane', '2');
  await expect(overdue).toHaveAttribute('data-quadrant', 'not_important_urgent');
  await expect(overdue).not.toContainText('逾期');
  await expect(overdue).not.toContainText('天');
  await expect(overdue.locator('.overdue-point')).toHaveCount(1);
  await expect(overdue.locator('.overdue-point-ring')).toHaveCount(1);
  const point = (await overdue.locator('.overdue-point').boundingBox())!;
  const pill = (await overdue.locator('.node-body').boundingBox())!;
  const title = (await overdue.locator('.node-title').boundingBox())!;
  expect(point.x).toBeGreaterThan(pill.x);
  expect(point.x + point.width).toBeLessThanOrEqual(pill.x + pill.width);
  expect(title.x + title.width).toBeLessThanOrEqual(point.x);
  // 标签里只有这一个圆形色标（普通任务左侧的色点已去掉）
  await expect(overdue.locator('circle:not(.overdue-point-ring)')).toHaveCount(1);

  // 矩阵下方不再有说明文字
  await expect(page.getByTestId('matrix-hidden')).toHaveCount(0);
  await expect(page.locator('.matrix-legend')).toHaveCount(0);
  await expect(page.getByText('逾期（3 天内贴右侧显示）')).toHaveCount(0);

  // 象限列表（表格视图）
  const quadrant = (name: string) => page.getByRole('region', { name, exact: true });
  await expect(quadrant('重要且紧急')).toContainText(t('明天重要'));
  await expect(quadrant('重要不紧急')).toContainText(t('无截止重要'));
  await expect(quadrant('紧急不重要')).toContainText(t('前两日截止'));
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

test('矩阵按日历日判档：不看几点几分，日期型和设了时刻的落格相同', async ({ page }) => {
  const id = runId();
  const t = (name: string) => `${id} ${name}`;
  const category = `${id}日历日`;
  await page.goto('/');
  await createCategory(page, category);
  await toggleCategory(page, category);

  await quickAdd(page, t('今天全天'), { deadline: localDate(0), importance: 4 });
  await quickAdd(page, t('明天零点半'), { deadline: localDate(1), time: '00:30', importance: 4 });
  await quickAdd(page, t('明天全天'), { deadline: localDate(1), importance: 4 });
  // 15 天后：N = 16 → 中线左侧第一格，不紧急
  await quickAdd(page, t('十五天后'), { deadline: localDate(15), importance: 4 });
  await switchMode(page, 'matrix');

  await expect(dot(page, t('今天全天'))).toHaveAttribute('data-column', '12');
  await expect(dot(page, t('明天零点半'))).toHaveAttribute('data-column', '11');
  await expect(dot(page, t('明天全天'))).toHaveAttribute('data-column', '11');
  await expect(dot(page, t('十五天后'))).toHaveAttribute('data-column', '6');
  await expect(dot(page, t('十五天后'))).toHaveAttribute('data-quadrant', 'important_not_urgent');
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
  await selectStatus(page, '全部');
  await page.getByRole('checkbox', { name: `完成：${title}` }).click();
  await expect(taskItem(page, title)).toHaveClass(/task-completed/);
  await switchMode(page, 'matrix');
  await expect(page.getByRole('img', { name: /时间管理矩阵/ })).toBeVisible();
  await expect(dot(page, title)).toHaveCount(0);
});

test('矩阵只受范围和分类影响：收藏只显示标星；清单页的状态原样保留、不再自动切回清单', async ({
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

  // 清单页选了"已完成"再切到矩阵：矩阵照常显示，不自动切回清单
  await selectStatus(page, '已完成');
  await switchMode(page, 'matrix');
  await expect(page).toHaveURL(/\/matrix\?status=completed/);
  await expect(page.locator('.matrix-node')).toHaveCount(2);
  await page.goto('/matrix?status=missed&cat=' + new URL(page.url()).searchParams.get('cat'));
  await expect(page).toHaveURL(/\/matrix\?/);
  await expect(page.locator('.matrix-node')).toHaveCount(2);

  // 收藏：只显示标星任务；标星不改变它在矩阵上的位置
  await selectScope(page, '收藏');
  await expect(page).toHaveURL(/\/matrix\?scope=starred/);
  await expect(page.locator('.matrix-node')).toHaveCount(1);
  await expect(dot(page, t('标星'))).toHaveAttribute('data-row', '4');
  await expect(page.getByRole('region', { name: '重要且紧急', exact: true })).toContainText(
    t('标星'),
  );
  await expect(page.getByRole('region', { name: '紧急不重要', exact: true })).not.toContainText(
    t('普通'),
  );

  // 切回清单：范围、分类、状态都还在
  await switchMode(page, 'list');
  await expect(page.getByRole('heading', { level: 1, name: '收藏' })).toBeVisible();
  await expect(statusBar(page).getByRole('button', { name: '已错过' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('逾期区：三条道按逾期天数越逾期越靠右，不写任何文字；满 3 天退场；只针对普通任务', async ({
  page,
}) => {
  const id = runId();
  const t = (name: string) => `${id} ${name}`;
  const category = `${id}逾期`;
  await page.goto('/');
  await createCategory(page, category);
  await toggleCategory(page, category);
  await selectStatus(page, '全部');
  // 今天 00:00 已经过去（除非恰好在午夜运行）→ 逾期 0 天
  await quickAdd(page, t('今日零点截止'), { deadline: localDate(0), time: '00:00', importance: 3 });
  // 日期型：从截止日期的次日 00:00 起逾期
  await quickAdd(page, t('昨天截止'), { deadline: localDate(-1), importance: 3 });
  await quickAdd(page, t('前天截止'), { deadline: localDate(-2), importance: 3 });
  await quickAdd(page, t('三天前截止'), { deadline: localDate(-3), importance: 3 });
  await switchMode(page, 'matrix');

  const lanes = [
    ['今日零点截止', '0'],
    ['昨天截止', '1'],
    ['前天截止', '2'],
  ] as const;
  const pointX: number[] = [];
  for (const [name, lane] of lanes) {
    const node = dot(page, t(name));
    await expect(node).toHaveAttribute('data-column', '13');
    await expect(node).toHaveAttribute('data-overdue-lane', lane);
    await expect(node).not.toContainText('逾期');
    await expect(node).not.toContainText('今天已过');
    pointX.push((await node.locator('.overdue-point').boundingBox())!.x);
  }
  // 越逾期越靠右，三条道都在逾期格内
  expect(pointX[0]!).toBeLessThan(pointX[1]!);
  expect(pointX[1]!).toBeLessThan(pointX[2]!);
  const strip = (await page.locator('.matrix-overdue-strip').boundingBox())!;
  for (const x of pointX) {
    expect(x).toBeGreaterThanOrEqual(strip.x);
    expect(x).toBeLessThanOrEqual(strip.x + strip.width);
  }
  // 逾期满 3 天：退场，只在清单的"已错过"里可见
  await expect(dot(page, t('三天前截止'))).toHaveCount(0);
  await switchMode(page, 'list');
  await selectStatus(page, '已错过');
  await expect(taskItem(page, t('三天前截止'))).toBeVisible();
});

test('四象限清单：每行有完成勾选，完成后离开矩阵和清单', async ({ page }) => {
  const id = runId();
  const title = `${id} 象限里完成`;
  const category = `${id}象限`;
  await page.goto('/');
  await createCategory(page, category);
  await toggleCategory(page, category);
  await quickAdd(page, title, { deadline: localDate(2), importance: 4 });
  await switchMode(page, 'matrix');

  const quadrant = page.getByRole('region', { name: '重要且紧急', exact: true });
  await quadrant.getByRole('checkbox', { name: `完成：${title}` }).click();
  await expect(quadrant).not.toContainText(title);
  await expect(dot(page, title)).toHaveCount(0);
  await switchMode(page, 'list');
  await expect(taskItem(page, title)).toHaveCount(0);
  await selectStatus(page, '已完成');
  await expect(taskItem(page, title)).toBeVisible();
});

test('对照表截图：固定 now 为周一 15:54，每个例子落在对应的格子里，标签不越过刻度线', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-05T15:54:00+08:00'));
  const id = runId();
  const category = `${id}周一`;
  await page.goto('/');
  await createCategory(page, category);
  await toggleCategory(page, category);
  await selectStatus(page, '全部');

  // [名称, 截止日期, 左侧刻度名, 右侧刻度名（null = 右侧是逾期区）]
  const table = [
    ['周一今天', '2026-10-05', '1天', null],
    ['周二', '2026-10-06', '2天', '1天'],
    ['周三', '2026-10-07', '3天', '2天'],
    ['周四', '2026-10-08', '5天', '3天'],
    ['周五', '2026-10-09', '5天', '3天'],
    ['周六', '2026-10-10', '一周', '5天'],
    ['周日', '2026-10-11', '一周', '5天'],
    ['下周一', '2026-10-12', '两周', '一周'],
    ['下周日', '2026-10-18', '两周', '一周'],
    ['再下周一', '2026-10-19', '三周', '两周'],
  ] as const;
  for (const [name, date] of table) {
    await quickAdd(page, `${id}${name}`, { deadline: date, importance: 3 });
  }
  await switchMode(page, 'matrix');

  const ticks = new Map<string, number>();
  for (const tick of await page.getByTestId('matrix-x-tick').all()) {
    ticks.set(
      (await tick.locator('text').textContent())!,
      (await tick.locator('line').boundingBox())!.x,
    );
  }
  const overdueLeft = (await page.locator('.matrix-overdue-strip').boundingBox())!.x;
  for (const [name, , left, right] of table) {
    const body = (await dot(page, `${id}${name}`).locator('.node-body').boundingBox())!;
    expect(body.x, `${name} 左端`).toBeGreaterThan(ticks.get(left)!);
    expect(body.x + body.width, `${name} 右端`).toBeLessThan(
      right === null ? overdueLeft : ticks.get(right)!,
    );
  }
  await page
    .locator('.matrix-card')
    .screenshot({ path: test.info().outputPath('monday-1554.png') });
});
