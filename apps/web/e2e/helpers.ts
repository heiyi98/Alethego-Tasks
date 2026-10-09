import { execFileSync } from 'node:child_process';

import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import { accessTokenFor, mainUser, type Credentials } from './auth';

export const TIME_ZONE = 'Asia/Shanghai';

/** 每个用例的随机前缀，用于在共享数据库中隔离数据 */
export function runId(): string {
  return `e2e${Math.random().toString(36).slice(2, 8)}`;
}

/** 距今 offsetDays 天的本地日期 YYYY-MM-DD（按 TIME_ZONE） */
export function localDate(offsetDays: number): string {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** 距今 offsetDays 天、指定时刻的 datetime-local 值（按 TIME_ZONE） */
export function localDateTime(offsetDays: number, time: string): string {
  return `${localDate(offsetDays)}T${time}`;
}

/** 直接查询数据库（taskapp schema）验证落库结果；按 RLS 只看得到这个账号（默认主测试账号）的数据 */
export async function queryRest<T>(
  request: APIRequestContext,
  path: string,
  credentials: Credentials = mainUser(),
): Promise<T> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const token = await accessTokenFor(credentials);
  const response = await request.get(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${token}`, 'Accept-Profile': 'taskapp' },
  });
  return (await response.json()) as T;
}

/* ---------------- 快速添加 ---------------- */

export const quickAddBar = (page: Page) => page.locator('.quick-add');

/** 在一组"重要性"按钮中选择 level */
/** 重要性四档的名字：0 = 随意、1 = 可以、2 = 应该、3 = 必须 */
export const IMPORTANCE_NAMES = ['随意', '可以', '应该', '必须'] as const;

export const importanceButton = (scope: Locator, level: number) =>
  scope
    .getByRole('group', { name: '重要性' })
    .getByRole('button', { name: IMPORTANCE_NAMES[level]!, exact: true });

export async function pickImportance(scope: Locator, level: number) {
  await importanceButton(scope, level).click();
}

export const dateInput = (scope: Locator) => scope.locator('input[aria-label="截止日期"]');
export const timeInput = (scope: Locator) => scope.locator('input[aria-label="截止时刻"]');

/** 点日期旁的时钟图标，选择具体到分钟的时刻（HH:MM） */
export async function setTime(scope: Locator, time: string) {
  const input = timeInput(scope);
  if ((await input.count()) === 0) await scope.getByRole('button', { name: '选择时刻' }).click();
  await input.fill(time);
}

/** 快速添加：可同时设置重要性与截止日期（YYYY-MM-DD），点输入栏右端的 ✓ 创建（enter: true 时按回车） */
export async function quickAdd(
  page: Page,
  title: string,
  options: {
    importance?: number;
    deadline?: string;
    time?: string;
    expectVisible?: boolean;
    enter?: boolean;
  } = {},
) {
  const bar = quickAddBar(page);
  const input = page.getByLabel('快速添加任务');
  await input.fill(title);
  if (options.importance !== undefined) await pickImportance(bar, options.importance);
  if (options.deadline) await dateInput(bar).fill(options.deadline);
  if (options.time) await setTime(bar, options.time);
  if (options.enter) await input.press('Enter');
  else await bar.getByRole('button', { name: '创建', exact: true }).click();
  await expect(input).toHaveValue('');
  if (options.expectVisible !== false) await expect(taskItem(page, title.trim())).toBeVisible();
}

/* ---------------- 列表与面板 ---------------- */

/** 列表中标题完全等于 title 的任务项（包含展开后的面板） */
export const taskItem = (page: Page, title: string) =>
  page
    .locator('.task-list > .task-item')
    .filter({ has: page.locator('.task-title').getByText(title, { exact: true }) });

/** 列表中以 prefix 开头的任务标题，按显示顺序 */
async function listedTitles(page: Page, prefix: string): Promise<string[]> {
  const all = await page.locator('.task-list .task-title').allTextContents();
  return all.filter((t) => t.startsWith(prefix));
}

/** 断言列表中本用例的任务及其顺序（等待筛选切换后的重新渲染） */
export async function expectTitles(page: Page, prefix: string, expected: string[]) {
  await expect.poll(() => listedTitles(page, prefix)).toEqual(expected);
}

export const editPanel = (page: Page) => page.getByRole('form', { name: '编辑任务' });
export const createPanel = (page: Page) => page.getByRole('form', { name: '新建任务' });

/** 面板中的标题输入框（列表中展开时就是原来那一行的标题） */
export const titleBox = (scope: Locator) =>
  scope.getByRole('textbox', { name: '标题', exact: true });

/** 在列表中点击任务标题：这一行留在原位变为可编辑，面板从它下方展开；返回任务 id */
export async function openTask(page: Page, title: string): Promise<string> {
  const item = taskItem(page, title);
  const main = item.locator('.task-main').first();
  const id = (await main.getAttribute('data-task-id'))!;
  await main.click();
  await expect(item).toHaveClass(/task-item-open/);
  await expect(titleBox(editPanel(page))).toHaveValue(title);
  return id;
}

/**
 * 点 ✓ 保存（改动只在点 ✓ 时保存，保存后面板收起），再展开同一条任务，接着看或改。
 * 保存后任务不在当前清单里了（例如完成后离开"未完成"）时不再展开。
 */
export async function waitSaved(page: Page) {
  const taskId = await editPanel(page).getAttribute('data-task-id');
  await editPanel(page).getByRole('button', { name: '完成编辑' }).first().click();
  await expect(editPanel(page)).toHaveCount(0);
  if (!taskId) return;
  const row = page.locator(`.task-main[data-task-id="${taskId}"]`).first();
  if ((await row.count()) === 0) return;
  await row.click();
  await expect(editPanel(page).locator('.task-editor')).toBeVisible();
}

/** 点 ✓：有不合法的字段时不保存，面板留着 */
export async function clickSave(page: Page) {
  await editPanel(page).getByRole('button', { name: '完成编辑' }).first().click();
}

/** 点三角收起面板 */
export async function collapse(page: Page) {
  // 点 ✓ 保存后面板已经收起
  if ((await page.locator('.task-editor').count()) === 0) return;
  await page.getByRole('button', { name: '收起', exact: true }).click();
  await expect(page.locator('.task-editor')).toHaveCount(0);
}

/** 点 ✓ 保存并收起 */
export async function saveAndCollapse(page: Page) {
  await editPanel(page).getByRole('button', { name: '完成编辑' }).first().click();
  await expect(editPanel(page)).toHaveCount(0);
}

/** 撤销提示条 */
export const toast = (page: Page, text: string | RegExp) =>
  page.locator('.toast').filter({ hasText: text });

/* ---------------- 侧边栏 ---------------- */

export const sidebar = (page: Page) => page.getByRole('navigation', { name: '主菜单' });

/** 页面内、添加栏下面的状态行（单选）：全部 / 未完成 / 已完成 / 已错过 */
export const statusBar = (page: Page) =>
  page.getByRole('main').getByRole('group', { name: '状态' });

export async function selectStatus(page: Page, label: string) {
  const button = statusBar(page).getByRole('button', { name: label, exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

/** 侧边栏最上面（单选导航）：总览 / 今日 / 收藏（链接名后面跟着计数） */
export const scopeItem = (page: Page, label: string) =>
  sidebar(page)
    .getByRole('region', { name: '范围' })
    .getByRole('link', { name: new RegExp(`^${label}`) });

export async function selectScope(page: Page, label: string) {
  await scopeItem(page, label).click();
  await expect(page.getByRole('heading', { level: 1, name: label })).toBeVisible();
}

/** 侧边栏"个人"分区里的一个分类（单选导航：点一下就是这个分类的页面） */
export const categoryItem = (page: Page, name: string) =>
  sidebar(page)
    .getByRole('region', { name: '个人' })
    .getByRole('link', { name: new RegExp(`^${name}`) });

/** 打开某个分类的页面：标题就是分类名，这一行整行高亮 */
export async function selectCategory(page: Page, name: string) {
  const item = categoryItem(page, name);
  await item.click();
  await expect(item).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

/** 在侧边栏新建分类（颜色默认取调色板中第一个未被使用的）；创建后不改变当前的选择 */
export async function createCategory(page: Page, name: string) {
  await sidebar(page).getByRole('button', { name: '+ 新建分类' }).click();
  const form = page.getByRole('form', { name: '新建分类' });
  await form.getByLabel('分类名称', { exact: true }).fill(name);
  await form.getByRole('button', { name: '添加分类' }).click();
  await expect(categoryItem(page, name)).toBeVisible();
}

/** 清单 / 矩阵切换（左上角 LOGO 右边的图标按钮；矩阵里在筛选栏上） */
export async function switchMode(page: Page, to: 'matrix' | 'list') {
  await page.getByRole('link', { name: to === 'matrix' ? '切换到矩阵' : '切换到清单' }).click();
  await expect(page).toHaveURL(to === 'matrix' ? /\/matrix/ : /localhost:\d+\/(\?|$)/);
}

/** 矩阵的筛选栏（进入矩阵后替换左边的侧边栏） */
export const filterBar = (page: Page) => page.getByRole('navigation', { name: '矩阵筛选' });

/** 筛选栏里某一行的勾选框（名字精确匹配） */
export const filterCheck = (page: Page, name: string) =>
  filterBar(page).getByRole('checkbox', { name, exact: true });

/**
 * 矩阵里只勾某一个个人分类（用例之间共用主测试账号：只看本用例的分类，别的用例的任务不出现）。
 * 先把"个人"整个取消（部分选中时点一下是全勾，再点一下是全不勾），再勾这个分类；组都不勾。
 */
export async function matrixOnlyCategory(page: Page, category: string) {
  const personal = filterCheck(page, '个人');
  for (let i = 0; i < 2 && (await personal.getAttribute('aria-checked')) !== 'false'; i++) {
    await personal.click();
  }
  await expect(personal).toHaveAttribute('aria-checked', 'false');
  for (const box of await filterBar(page)
    .getByRole('region', { name: '组' })
    .getByRole('checkbox')
    .all()) {
    if (await box.isChecked()) await box.uncheck();
  }
  await filterCheck(page, category).check();
}

/** 矩阵里勾上全部个人任务、组都不勾（用例之间共用主测试账号，上一个用例的勾选会留在账号上） */
export async function matrixAllPersonal(page: Page) {
  const personal = filterCheck(page, '个人');
  if ((await personal.getAttribute('aria-checked')) !== 'true') await personal.click();
  await expect(personal).toHaveAttribute('aria-checked', 'true');
  for (const box of await filterBar(page)
    .getByRole('region', { name: '组' })
    .getByRole('checkbox')
    .all()) {
    if (await box.isChecked()) await box.uncheck();
  }
}

/* ---------------- 数据库时钟（只用于本地端到端测试） ---------------- */

/**
 * 本地数据库的直连地址（E2E_DATABASE_URL，写在 .env.local）。
 * 全局准备时执行 e2e/sql/test-clock.sql，之后可以用 setDbClock 把数据库的"当前时间"固定下来。
 */
export const dbUrl = () => process.env.E2E_DATABASE_URL;

export function runSql(sql: string) {
  const url = dbUrl();
  if (!url) throw new Error('需要在 .env.local 中配置 E2E_DATABASE_URL');
  execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-q', '-c', sql], { stdio: 'pipe' });
}

/** 固定数据库时钟（taskapp.clock_now()）；null = 恢复成真实时间 */
export function setDbClock(at: Date | null) {
  runSql(
    at
      ? `insert into taskapp.test_clock (id, fixed_at) values (1, '${at.toISOString()}')
         on conflict (id) do update set fixed_at = excluded.fixed_at`
      : 'delete from taskapp.test_clock',
  );
}
