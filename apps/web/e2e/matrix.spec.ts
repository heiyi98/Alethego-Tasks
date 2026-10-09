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
  filterBar,
  matrixOnlyCategory,
  selectCategory,
  waitSaved,
} from './helpers';

/** 任务的标签（role=button，带位置信息）；圆点在单独一层，见 dotOf */
const dot = (page: Page, title: string) => page.locator(`.matrix-node[aria-label^="${title}，"]`);
async function dotOf(page: Page, title: string) {
  const id = await dot(page, title).getAttribute('data-task-id');
  return page.locator(`.matrix-dot[data-task-id="${id}"]`);
}
/** 短期 / 长期：矩阵上方的文字胶囊，显示当前模式 */
const modeToggle = (page: Page) => page.locator('.matrix-toolbar').getByRole('button');
async function setMatrixMode(page: Page, mode: 'short' | 'long') {
  const card = page.locator('.matrix-card');
  if ((await card.getAttribute('data-mode')) !== mode) await modeToggle(page).click();
  await expect(card).toHaveAttribute('data-mode', mode);
}
/** 分界线的横坐标（SVG 坐标），按刻度名 */
async function tickXs(page: Page): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const tick of await page.getByTestId('matrix-x-tick').all()) {
    map.set(
      (await tick.locator('text').textContent())!,
      Number(await tick.locator('line').getAttribute('x1')),
    );
  }
  return map;
}
/** 圆点中心（SVG 坐标） */
async function dotCenter(page: Page, title: string) {
  const transform = (await (await dotOf(page, title)).getAttribute('transform'))!;
  const [x, y] = transform.match(/-?[\d.]+/g)!.map(Number);
  return { x: x!, y: y! };
}
const stripRange = (page: Page) =>
  page.locator('.matrix-overdue-strip').evaluate((r) => ({
    left: Number(r.getAttribute('x')),
    right: Number(r.getAttribute('x')) + Number(r.getAttribute('width')),
  }));

test('矩阵：短期 / 长期两种模式，6 格等宽、中线在正中；逾期区 1/4 格；按紧迫度 × 重要性放置，点击弹出编辑面板', async ({
  page,
}) => {
  const id = runId();
  const t = (name: string) => `${id} ${name}`;
  const category = `${id}矩阵`;

  // 选中本用例的分类后快速添加：自动带上该分类，并直接带上截止日期与重要性
  await page.goto('/');
  await createCategory(page, category);
  await selectCategory(page, category);
  await selectStatus(page, '全部');

  const specs = [
    { name: '明天重要', deadline: localDate(1), importance: 3 },
    { name: '下月不重要', deadline: localDate(30), importance: 1 },
    { name: '无截止重要', importance: 2 },
    { name: '前两日截止', deadline: localDate(-2), importance: 1 },
    { name: '远期', deadline: localDate(500), importance: 2 },
    { name: '未处理' },
  ];
  for (const { name, ...options } of specs) await quickAdd(page, t(name), options);

  // LOGO 右边的图标按钮切到矩阵；左边换成筛选栏；矩阵页没有标题、状态行和添加栏
  await switchMode(page, 'matrix');
  await matrixOnlyCategory(page, category);
  await expect(page).toHaveURL(/cat=/);
  await expect(page.locator('h1.title-bar')).toHaveCount(0);
  await expect(statusBar(page)).toHaveCount(0);
  await expect(page.getByLabel('快速添加任务')).toHaveCount(0);
  await expect(filterBar(page).getByRole('link', { name: '切换到清单' })).toBeVisible();

  // 矩阵没有外框，和页面背景融为一体
  const card = page.locator('.matrix-card');
  await expect(card).toHaveCSS('border-top-style', 'none');
  await expect(card).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  // 默认短期；切换是矩阵上方单独一行的文字胶囊，显示当前模式名，不与矩阵图重叠
  await expect(card).toHaveAttribute('data-mode', 'short');
  const toggle = modeToggle(page);
  await expect(toggle).toHaveText('短期');
  const svgBox = (await page.locator('svg.matrix').boundingBox())!;
  const toggleBox = (await toggle.boundingBox())!;
  expect(toggleBox.y + toggleBox.height).toBeLessThanOrEqual(svgBox.y);

  // 短期：N > 14 的不画；远期与未处理不显示
  await expect(page.locator('.matrix-node')).toHaveCount(3);

  // Y 轴：刻度 0–3 标在分界线上，顶端没有"4"
  await expect(page.getByTestId('matrix-y-tick')).toHaveText(['0', '1', '2', '3']);

  // X 轴：刻度名在分界线上，从左到右；逾期区不写字
  const shortTicks = ['两周', '一周', '5天', '3天', '2天', '1天'];
  await expect(page.getByTestId('matrix-x-tick')).toHaveText(shortTicks);
  // 矩阵图里只允许出现四种文字：X 轴刻度名、Y 轴刻度数字、四个方位字、任务标题
  const nonTaskTexts = () =>
    page.locator('svg.matrix > text, svg.matrix > g:not(.matrix-node) text').allTextContents();
  const fixedTexts = ['0', '1', '2', '3', '不紧急', '紧急', '重要', '不重要'];
  expect((await nonTaskTexts()).sort()).toEqual([...shortTicks, ...fixedTexts].sort());

  // 6 格等宽：相邻分界线间距相同；中线在 6 格正中（"3天"上）；逾期区是接在右边的 1/4 格
  const geometry = async () => {
    const xs = await page
      .getByTestId('matrix-x-tick')
      .locator('line')
      .evaluateAll((lines) => lines.map((l) => Number(l.getAttribute('x1'))));
    const w = xs[1]! - xs[0]!;
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeCloseTo(w, 5);
    const divider = await page
      .locator('.matrix-divider')
      .first()
      .evaluate((l) => Number(l.getAttribute('x1')));
    const strip = await stripRange(page);
    return { xs, w, divider, strip };
  };
  const short = await geometry();
  expect(short.divider).toBeCloseTo(short.xs[3]!, 5);
  expect(short.strip.left).toBeCloseTo(short.xs[5]! + short.w, 5);
  expect(short.strip.right - short.strip.left).toBeCloseTo(short.w / 4, 5);
  expect((short.divider - short.xs[0]!) / short.w).toBeCloseTo(3, 5);

  // 标签：没有外框和背景，标题写在细横线上；标题最多 6 个汉字宽，超出用省略号
  const tomorrow = dot(page, t('明天重要'));
  await expect(tomorrow.locator('rect.node-body')).toHaveCount(0);
  await expect(tomorrow.locator('.node-line')).toHaveCount(1);
  // 每个标签都有一条细线连回自己的圆点
  await expect(page.locator('.matrix-node .node-leader')).toHaveCount(3);
  // 标题不超过 45ch 时完整显示
  await expect(tomorrow.locator('.node-title')).toHaveText(t('明天重要'));
  // 明天：N = 2 → "2天–1天"那一格；圆点在格子里
  await expect(tomorrow).toHaveAttribute('data-quadrant', 'important_urgent');
  await expect(tomorrow).toHaveAttribute('data-column', '4');
  await expect(tomorrow).toHaveAttribute('data-row', '3');
  const shortTickX = await tickXs(page);
  const c = await dotCenter(page, t('明天重要'));
  expect(c.x).toBeGreaterThan(shortTickX.get('2天')!);
  expect(c.x).toBeLessThan(shortTickX.get('1天')!);

  // 没设截止日期、设了重要性：圆点贴在图的最左边缘（完整可见）
  const leftAxis = await page
    .locator('.matrix-axis')
    .first()
    .evaluate((l) => Number(l.getAttribute('x1')));
  await expect(dot(page, t('无截止重要'))).toHaveAttribute('data-column', 'no-deadline');
  await expect(dot(page, t('无截止重要'))).toHaveAttribute('data-quadrant', 'important_not_urgent');
  const noDeadline = await dotCenter(page, t('无截止重要'));
  expect(noDeadline.x - 5).toBeGreaterThanOrEqual(leftAxis);
  expect(noDeadline.x - 5).toBeLessThan(leftAxis + 3);

  // 逾期：一个区，不分道，不写字；圆点在逾期区里
  const overdue = dot(page, t('前两日截止'));
  await expect(overdue).toHaveAttribute('data-column', 'overdue');
  await expect(overdue).not.toHaveAttribute('data-overdue-lane', /.*/);
  await expect(overdue).toHaveAttribute('data-quadrant', 'not_important_urgent');
  await expect(overdue).not.toContainText('逾期');
  await expect(overdue).not.toContainText('天');
  const overdueDot = await dotOf(page, t('前两日截止'));
  await expect(overdueDot.locator('.overdue-point-ring')).toHaveCount(1);
  const od = await dotCenter(page, t('前两日截止'));
  expect(od.x).toBeGreaterThan(short.strip.left);
  expect(od.x).toBeLessThan(short.strip.right);
  await expect(overdue).toHaveClass(/matrix-node-overdue/);

  // 矩阵下方不再有说明文字
  await expect(page.getByTestId('matrix-hidden')).toHaveCount(0);
  await expect(page.locator('.matrix-legend')).toHaveCount(0);

  // 四象限清单：显示哪些任务与模式无关（下月的任务图上不画，但在清单里）；远期与未处理不显示
  const quadrant = (name: string) => page.getByRole('region', { name, exact: true });
  await expect(quadrant('重要且紧急')).toContainText(t('明天重要'));
  await expect(quadrant('重要不紧急')).toContainText(t('无截止重要'));
  await expect(quadrant('紧急不重要')).toContainText(t('前两日截止'));
  await expect(quadrant('不重要不紧急')).toContainText(t('下月不重要'));
  await expect(page.locator('.quadrant-lists')).not.toContainText(t('远期'));
  await expect(page.locator('.quadrant-lists')).not.toContainText(t('未处理'));

  // 没有悬停效果：悬停不出提示框
  await tomorrow.hover();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(page.locator('[title]')).toHaveCount(0);

  // 切到长期：图标随之变化，中线位置不动；下月的任务出现在"一季度–一个月"那一格
  await toggle.click();
  await expect(card).toHaveAttribute('data-mode', 'long');
  await expect(modeToggle(page)).toHaveText('长期');
  const longTicks = ['半年', '一季度', '一个月', '两周', '一周', '3天'];
  await expect(page.getByTestId('matrix-x-tick')).toHaveText(longTicks);
  expect((await nonTaskTexts()).sort()).toEqual([...longTicks, ...fixedTexts].sort());
  const long = await geometry();
  expect(long.divider).toBeCloseTo(short.divider, 5);
  expect(long.strip).toEqual(short.strip);
  await expect(page.locator('.matrix-node')).toHaveCount(4);
  await expect(dot(page, t('下月不重要'))).toHaveAttribute('data-column', '1');
  await expect(dot(page, t('明天重要'))).toHaveAttribute('data-column', '5');
  await expect(dot(page, t('无截止重要'))).toHaveAttribute('data-column', 'no-deadline');
  await expect(dot(page, t('前两日截止'))).toHaveAttribute('data-column', 'overdue');
  expect(await dotCenter(page, t('无截止重要'))).toEqual(noDeadline);

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
  // 点圆点同样弹出面板
  await (await dotOf(page, t('下月不重要'))).click();
  await expect(titleBox(dialog)).toHaveValue(t('下月不重要'));
  await page.mouse.click(5, 5);
  await expect(dialog).toHaveCount(0);

  // 象限列表中的任务在原地展开
  await quadrant('紧急不重要').getByText(t('明天重要'), { exact: true }).click();
  await expect(quadrant('紧急不重要').getByRole('form', { name: '编辑任务' })).toBeVisible();
});

test('矩阵按日历日判档：不看几点几分；紧急与否跟着模式，四象限清单随之重新分组', async ({
  page,
}) => {
  const id = runId();
  const t = (name: string) => `${id} ${name}`;
  const category = `${id}日历日`;
  await page.goto('/');
  await createCategory(page, category);
  await selectCategory(page, category);

  await quickAdd(page, t('今天全天'), { deadline: localDate(0), importance: 2 });
  await quickAdd(page, t('明天零点半'), { deadline: localDate(1), time: '00:30', importance: 2 });
  await quickAdd(page, t('明天全天'), { deadline: localDate(1), importance: 2 });
  // 9 天后：N = 10
  await quickAdd(page, t('十天'), { deadline: localDate(9), importance: 2 });
  // 15 天后：N = 16
  await quickAdd(page, t('十六天'), { deadline: localDate(15), importance: 2 });
  await switchMode(page, 'matrix');
  await matrixOnlyCategory(page, category);
  await setMatrixMode(page, 'short');

  await expect(dot(page, t('今天全天'))).toHaveAttribute('data-column', '5');
  await expect(dot(page, t('明天零点半'))).toHaveAttribute('data-column', '4');
  await expect(dot(page, t('明天全天'))).toHaveAttribute('data-column', '4');
  await expect(dot(page, t('十天'))).toHaveAttribute('data-column', '0');
  await expect(dot(page, t('十六天'))).toHaveCount(0);

  // 短期：N ≤ 3 为紧急
  const quadrant = (name: string) => page.getByRole('region', { name, exact: true });
  await expect(dot(page, t('十天'))).toHaveAttribute('data-quadrant', 'important_not_urgent');
  await expect(quadrant('重要不紧急')).toContainText(t('十天'));
  await expect(quadrant('重要不紧急')).toContainText(t('十六天'));
  await expect(quadrant('重要且紧急')).toContainText(t('明天全天'));

  // 长期：N ≤ 14 为紧急；清单里还是这些任务，只是重新分组
  await setMatrixMode(page, 'long');
  await expect(dot(page, t('今天全天'))).toHaveAttribute('data-column', '5');
  await expect(dot(page, t('明天全天'))).toHaveAttribute('data-column', '5');
  await expect(dot(page, t('十天'))).toHaveAttribute('data-column', '3');
  await expect(dot(page, t('十六天'))).toHaveAttribute('data-column', '2');
  await expect(dot(page, t('十天'))).toHaveAttribute('data-quadrant', 'important_urgent');
  await expect(quadrant('重要且紧急')).toContainText(t('十天'));
  await expect(quadrant('重要不紧急')).toContainText(t('十六天'));
  await expect(quadrant('重要不紧急')).not.toContainText(t('十天'));
});

test('标签标题最宽 45ch（随字号变化），超出按宽度截断加省略号，所有语言同一个宽度', async ({
  page,
}) => {
  const id = runId();
  const category = `${id}长标题`;
  const cjk = `${id} ${'很长的中文标题'.repeat(12)}`;
  const latin = `${id} ${'a long english title '.repeat(10)}`.trimEnd();
  const fits = `${id} 不超过宽度的标题`;
  await page.goto('/');
  await createCategory(page, category);
  await selectCategory(page, category);
  for (const title of [cjk, latin, fits]) {
    await quickAdd(page, title, { deadline: localDate(1), importance: 2 });
  }
  await switchMode(page, 'matrix');
  await matrixOnlyCategory(page, category);

  // 1ch = 标签字体里"0"的宽度
  const ch = await page.evaluate(() => {
    const svg = document.querySelector('svg.matrix')!;
    const probe = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    probe.setAttribute('class', 'node-title');
    probe.textContent = '0'.repeat(45);
    svg.appendChild(probe);
    const width = probe.getComputedTextLength() / 45;
    probe.remove();
    return width;
  });
  const widthOf = (title: string) =>
    dot(page, title)
      .locator('.node-title')
      .evaluate((el) => (el as SVGTextContentElement).getComputedTextLength());

  for (const title of [cjk, latin]) {
    const shown = (await dot(page, title).locator('.node-title').textContent())!;
    expect(shown.endsWith('…')).toBe(true);
    expect(title.startsWith(shown.slice(0, -1).trimEnd())).toBe(true);
    const width = await widthOf(title);
    expect(width).toBeLessThanOrEqual(45 * ch + 0.5);
    // 不是按字符数截断：两种文字截出来的宽度都接近 45ch
    expect(width).toBeGreaterThan(40 * ch);
  }
  const cjkShown = (await dot(page, cjk).locator('.node-title').textContent())!;
  const latinShown = (await dot(page, latin).locator('.node-title').textContent())!;
  expect(Array.from(latinShown).length).toBeGreaterThan(Array.from(cjkShown).length);
  await expect(dot(page, fits).locator('.node-title')).toHaveText(fits);
});

test('矩阵：完成任务后从矩阵消失；筛选栏没勾它的分类时不显示', async ({ page }) => {
  const id = runId();
  const title = `${id} 待完成`;
  const mine = `${id}自己`;
  const other = `${id}其他`;
  await page.goto('/');
  await createCategory(page, mine);
  await createCategory(page, other);
  await selectCategory(page, mine);
  await quickAdd(page, title, { deadline: localDate(2), importance: 2 });

  await switchMode(page, 'matrix');
  await matrixOnlyCategory(page, mine);
  await expect(dot(page, title)).toHaveCount(1);

  // 只勾一个该任务不属于的分类 → 不显示
  await matrixOnlyCategory(page, other);
  await expect(dot(page, title)).toHaveCount(0);
  await matrixOnlyCategory(page, mine);

  await switchMode(page, 'list');
  await selectStatus(page, '全部');
  await page.getByRole('checkbox', { name: `完成：${title}` }).click();
  await expect(taskItem(page, title)).toHaveClass(/task-completed/);
  await switchMode(page, 'matrix');
  await expect(page.getByRole('img', { name: /时间管理矩阵/ })).toBeVisible();
  await expect(dot(page, title)).toHaveCount(0);
});

test('矩阵只看筛选栏的勾选，不受清单所在页面和状态影响；回到清单时回到原来的页面和状态', async ({
  page,
}) => {
  const id = runId();
  const t = (name: string) => `${id} ${name}`;
  const category = `${id}状态`;
  await page.goto('/');
  await createCategory(page, category);
  await selectCategory(page, category);
  await quickAdd(page, t('标星'), { deadline: localDate(2), importance: 3 });
  await quickAdd(page, t('普通'), { deadline: localDate(1), importance: 1 });
  await taskItem(page, t('标星')).getByRole('button', { name: '标星', exact: true }).click();
  await expect(taskItem(page, t('标星')).getByRole('button', { name: '取消标星' })).toBeVisible();

  // 清单页选了"已完成"再切到矩阵：矩阵照常显示勾选的内容
  await selectStatus(page, '已完成');
  await switchMode(page, 'matrix');
  await expect(page).toHaveURL(/\/matrix\?cat=.*status=completed/);
  await matrixOnlyCategory(page, category);
  await expect(page.locator('.matrix-node')).toHaveCount(2);
  await expect(dot(page, t('标星'))).toHaveAttribute('data-row', '3');
  await expect(page.getByRole('region', { name: '重要且紧急', exact: true })).toContainText(
    t('标星'),
  );
  await expect(page.getByRole('region', { name: '紧急不重要', exact: true })).toContainText(
    t('普通'),
  );

  // 切回清单：回到这个分类、状态还是"已完成"
  await switchMode(page, 'list');
  await expect(page.getByRole('heading', { level: 1, name: category })).toBeVisible();
  await expect(statusBar(page).getByRole('button', { name: '已完成' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // 从"收藏"进入矩阵：还是上一次的勾选（不是只看标星）
  await selectScope(page, '收藏');
  await switchMode(page, 'matrix');
  await expect(page).toHaveURL(/\/matrix\?scope=starred/);
  await expect(page.locator('.matrix-node')).toHaveCount(2);
  await switchMode(page, 'list');
  await expect(page.getByRole('heading', { level: 1, name: '收藏' })).toBeVisible();
});

test('逾期区：一个区、不分道、不写字；圆点按重要性竖向定位、互不重叠；满 3 天退场；两种模式都有', async ({
  page,
}) => {
  const id = runId();
  const t = (name: string) => `${id} ${name}`;
  const category = `${id}逾期`;
  await page.goto('/');
  await createCategory(page, category);
  await selectCategory(page, category);
  await selectStatus(page, '全部');
  // 今天 00:00 已经过去（除非恰好在午夜运行）→ 逾期 0 天
  await quickAdd(page, t('今日零点截止'), { deadline: localDate(0), time: '00:00', importance: 2 });
  // 日期型：从截止日期的次日 00:00 起逾期
  await quickAdd(page, t('昨天截止'), { deadline: localDate(-1), importance: 2 });
  await quickAdd(page, t('前天截止'), { deadline: localDate(-2), importance: 2 });
  await quickAdd(page, t('不重要的'), { deadline: localDate(-1), importance: 1 });
  await quickAdd(page, t('三天前截止'), { deadline: localDate(-3), importance: 2 });
  await switchMode(page, 'matrix');
  await matrixOnlyCategory(page, category);

  for (const mode of ['short', 'long'] as const) {
    await setMatrixMode(page, mode);
    const strip = await stripRange(page);
    const centers: { x: number; y: number }[] = [];
    for (const name of ['今日零点截止', '昨天截止', '前天截止', '不重要的']) {
      const node = dot(page, t(name));
      await expect(node).toHaveAttribute('data-column', 'overdue');
      await expect(node).not.toContainText('逾期');
      await expect(node).not.toContainText('今天已过');
      const c = await dotCenter(page, t(name));
      expect(c.x).toBeGreaterThan(strip.left);
      expect(c.x).toBeLessThan(strip.right);
      centers.push(c);
    }
    // 圆点互不重叠（半径 5 + 红圈）
    for (let i = 0; i < centers.length; i++) {
      for (let j = i + 1; j < centers.length; j++) {
        const d = Math.hypot(centers[i]!.x - centers[j]!.x, centers[i]!.y - centers[j]!.y);
        expect(d).toBeGreaterThanOrEqual(13);
      }
    }
    // 竖向按重要性：可以（1）在应该（2）的下面
    expect(centers[3]!.y).toBeGreaterThan(Math.max(centers[0]!.y, centers[1]!.y, centers[2]!.y));
    // 逾期区里没有刻度
    await expect(page.getByTestId('matrix-x-tick').locator('line')).toHaveCount(6);
    // 逾期满 3 天：退场
    await expect(dot(page, t('三天前截止'))).toHaveCount(0);
  }
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
  await selectCategory(page, category);
  await quickAdd(page, title, { deadline: localDate(2), importance: 2 });
  await switchMode(page, 'matrix');
  await matrixOnlyCategory(page, category);

  const quadrant = page.getByRole('region', { name: '重要且紧急', exact: true });
  await quadrant.getByRole('checkbox', { name: `完成：${title}` }).click();
  await expect(quadrant).not.toContainText(title);
  await expect(dot(page, title)).toHaveCount(0);
  await switchMode(page, 'list');
  await expect(taskItem(page, title)).toHaveCount(0);
  await selectStatus(page, '已完成');
  await expect(taskItem(page, title)).toBeVisible();
});

/** 两条线段是否真正交叉 */
function crosses(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number },
) {
  const cross = (ox: number, oy: number, px: number, py: number, qx: number, qy: number) =>
    (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
  const d1 = cross(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
  const d2 = cross(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
  const d3 = cross(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
  const d4 = cross(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
  return d1 * d2 < -1e-9 && d3 * d4 < -1e-9;
}

test('对照表截图：固定 now 为周一 15:54；短期、长期各一张，同一格挤 10 个任务时力导向排布的标签互不重叠、连线不交叉也不穿过标签、圆点全部可见且都在对的格里', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.clock.setFixedTime(new Date('2026-10-05T15:54:00+08:00'));
  const id = runId();
  const category = `${id}周一`;
  await page.goto('/');
  await createCategory(page, category);
  await selectCategory(page, category);
  await selectStatus(page, '全部');

  // [标题, 截止日期, 短期所在格的左右刻度名, 长期所在格的左右刻度名]；null = 不显示；右侧 null = 逾期区
  type Cell = readonly [string, string | null] | null;
  const table: (readonly [string, string, Cell, Cell])[] = [
    ['周一·日报', '2026-10-05', ['1天', null], ['3天', null]],
    ['周三·家长会', '2026-10-07', ['3天', '2天'], ['3天', null]],
    ['周四·评审', '2026-10-08', ['5天', '3天'], ['一周', '3天']],
    ['周五·报销', '2026-10-09', ['5天', '3天'], ['一周', '3天']],
    ['周六·洗车', '2026-10-10', ['一周', '5天'], ['一周', '3天']],
    ['周日·看父母', '2026-10-11', ['一周', '5天'], ['一周', '3天']],
    ['下周一·牙医', '2026-10-12', ['两周', '一周'], ['两周', '一周']],
    ['下周日·读书会', '2026-10-18', ['两周', '一周'], ['两周', '一周']],
    ['第15天·签证', '2026-10-19', null, ['一个月', '两周']],
    ['第30天·体检', '2026-11-03', null, ['一个月', '两周']],
    ['第31天·年会', '2026-11-04', null, ['一季度', '一个月']],
    ['第90天·述职', '2027-01-02', null, ['一季度', '一个月']],
    ['第91天·搬家', '2027-01-03', null, ['半年', '一季度']],
    ['第180天·复查', '2027-04-02', null, ['半年', '一季度']],
    ['第181天·远的', '2027-04-03', null, null],
  ];
  // 同一格里挤 10 个：周二（短期"2天–1天"，长期"3天"那一格）、同一重要性
  const crowded = [
    '汇报',
    '合同',
    '房租',
    '体检预约',
    '周会',
    '回邮件',
    '买菜',
    '跑步',
    '改设计稿',
    '取快递',
  ];
  for (const [title, date] of table) {
    await quickAdd(page, title, { deadline: date, importance: 2 });
  }
  for (const name of crowded) {
    await quickAdd(page, `周二·${name}`, { deadline: '2026-10-06', importance: 3 });
  }
  const crowdedTable = crowded.map(
    (name) => [`周二·${name}`, '2026-10-06', ['2天', '1天'], ['3天', null]] as const,
  );
  await switchMode(page, 'matrix');
  await matrixOnlyCategory(page, category);

  for (const mode of ['short', 'long'] as const) {
    await setMatrixMode(page, mode);
    const ticks = await tickXs(page);
    const strip = await stripRange(page);
    // 每个圆点都落在对的格里（不贴刻度线）；不显示的不画
    for (const [title, , shortCell, longCell] of [...table, ...crowdedTable]) {
      const cell = mode === 'short' ? shortCell : longCell;
      if (cell === null) {
        await expect(dot(page, title), `${mode} ${title}`).toHaveCount(0);
        continue;
      }
      const { x } = await dotCenter(page, title);
      const [left, right] = cell;
      expect(x, `${mode} ${title} 左`).toBeGreaterThan(ticks.get(left)! + 5);
      expect(x, `${mode} ${title} 右`).toBeLessThan((right ? ticks.get(right)! : strip.left) - 5);
    }

    // 圆点互不重叠
    const centers = await page.locator('.matrix-dot').evaluateAll((gs) =>
      gs.map((g) =>
        g
          .getAttribute('transform')!
          .match(/-?[\d.]+/g)!
          .map(Number),
      ),
    );
    for (let i = 0; i < centers.length; i++) {
      for (let j = i + 1; j < centers.length; j++) {
        const d = Math.hypot(centers[i]![0]! - centers[j]![0]!, centers[i]![1]! - centers[j]![1]!);
        expect(d, `${mode} 圆点 ${i}/${j}`).toBeGreaterThanOrEqual(10);
      }
    }

    // 连线互不交叉
    const leaders = await page.locator('.node-leader').evaluateAll((ls) =>
      ls.map((l) => ({
        x1: Number(l.getAttribute('x1')),
        y1: Number(l.getAttribute('y1')),
        x2: Number(l.getAttribute('x2')),
        y2: Number(l.getAttribute('y2')),
      })),
    );
    expect(leaders.length, `${mode} 每个标签一条连线`).toBe(
      await page.locator('.matrix-node').count(),
    );
    for (let i = 0; i < leaders.length; i++) {
      for (let j = i + 1; j < leaders.length; j++) {
        expect(crosses(leaders[i]!, leaders[j]!), `${mode} 连线 ${i}/${j}`).toBe(false);
      }
    }

    // 力导向排布：标签互不重叠，连线不穿过别的标签，标签不压圆点（圆点全部完全可见）
    const labels = await page.locator('.matrix-node').evaluateAll((gs) =>
      gs.map((g) => {
        const r = g.querySelector('.node-hit')!;
        const l = g.querySelector('.node-leader')!;
        const left = Number(r.getAttribute('x'));
        const top = Number(r.getAttribute('y'));
        return {
          title: g.getAttribute('aria-label')!.split('，')[0]!,
          rect: {
            left,
            top,
            right: left + Number(r.getAttribute('width')),
            bottom: top + Number(r.getAttribute('height')),
          },
          leader: {
            x1: Number(l.getAttribute('x1')),
            y1: Number(l.getAttribute('y1')),
            x2: Number(l.getAttribute('x2')),
            y2: Number(l.getAttribute('y2')),
          },
        };
      }),
    );
    type Box = { left: number; top: number; right: number; bottom: number };
    const overlap = (a: Box, b: Box) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.01 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.01;
    const through = (seg: (typeof labels)[number]['leader'], r: Box) => {
      for (let k = 1; k < 50; k++) {
        const x = seg.x1 + ((seg.x2 - seg.x1) * k) / 50;
        const y = seg.y1 + ((seg.y2 - seg.y1) * k) / 50;
        if (x > r.left && x < r.right && y > r.top && y < r.bottom) return true;
      }
      return false;
    };
    for (let i = 0; i < labels.length; i++) {
      for (let j = 0; j < labels.length; j++) {
        if (i === j) continue;
        const pair = `${mode} ${labels[i]!.title} / ${labels[j]!.title}`;
        if (j > i) expect(overlap(labels[i]!.rect, labels[j]!.rect), `${pair} 重叠`).toBe(false);
        expect(through(labels[i]!.leader, labels[j]!.rect), `${pair} 连线穿过`).toBe(false);
      }
      for (const [x, y] of centers) {
        const r = labels[i]!.rect;
        const px = Math.min(Math.max(x!, r.left), r.right);
        const py = Math.min(Math.max(y!, r.top), r.bottom);
        expect(
          Math.hypot(x! - px, y! - py),
          `${mode} ${labels[i]!.title} 压到圆点`,
        ).toBeGreaterThanOrEqual(5);
      }
    }

    // 截图：矩阵上方的模式胶囊 + 矩阵图
    const top = (await page.locator('.matrix-toolbar').boundingBox())!;
    const chart = (await page.locator('.matrix-card').boundingBox())!;
    await page.screenshot({
      path: test.info().outputPath(`monday-1554-${mode}.png`),
      clip: { x: chart.x, y: top.y, width: chart.width, height: chart.y + chart.height - top.y },
    });
    // 同样的数据刷新后排布完全一样
    if (mode === 'long') {
      const before = await page
        .locator('.matrix-node .node-hit')
        .evaluateAll((rs) => rs.map((r) => r.getAttribute('x') + ',' + r.getAttribute('y')));
      await page.reload();
      await setMatrixMode(page, 'long');
      await expect
        .poll(() =>
          page
            .locator('.matrix-node .node-hit')
            .evaluateAll((rs) => rs.map((r) => r.getAttribute('x') + ',' + r.getAttribute('y'))),
        )
        .toEqual(before);
    }
  }
});
