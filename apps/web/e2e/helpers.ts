import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

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

/** 直接查询数据库（taskapp schema）验证落库结果 */
export async function queryRest<T>(request: APIRequestContext, path: string): Promise<T> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const response = await request.get(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Accept-Profile': 'taskapp' },
  });
  return (await response.json()) as T;
}

/* ---------------- 快速添加 ---------------- */

export const quickAddBar = (page: Page) => page.locator('.quick-add');

/** 在一组"重要性"按钮中选择 level */
export async function pickImportance(scope: Locator, level: number) {
  await scope
    .getByRole('group', { name: '重要性' })
    .getByRole('button', { name: `重要性 ${level}`, exact: true })
    .click();
}

export const dateInput = (scope: Locator) => scope.locator('input[aria-label="截止日期"]');
export const timeInput = (scope: Locator) => scope.locator('input[aria-label="截止时刻"]');

/** 点日期旁的时钟图标，选择具体到分钟的时刻（HH:MM） */
export async function setTime(scope: Locator, time: string) {
  const input = timeInput(scope);
  if ((await input.count()) === 0) await scope.getByRole('button', { name: '选择时刻' }).click();
  await input.fill(time);
}

/** 快速添加：可同时设置重要性与截止日期（YYYY-MM-DD），回车创建 */
export async function quickAdd(
  page: Page,
  title: string,
  options: { importance?: number; deadline?: string; time?: string; expectVisible?: boolean } = {},
) {
  const bar = quickAddBar(page);
  const input = page.getByLabel('快速添加任务');
  await input.fill(title);
  if (options.importance !== undefined) await pickImportance(bar, options.importance);
  if (options.deadline) await dateInput(bar).fill(options.deadline);
  if (options.time) await setTime(bar, options.time);
  await input.press('Enter');
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

/** 等待自动保存完成 */
export async function waitSaved(page: Page) {
  await expect(editPanel(page)).toHaveAttribute('data-save-state', 'saved');
}

/** 点三角收起面板 */
export async function collapse(page: Page) {
  await page.getByRole('button', { name: '收起', exact: true }).click();
  await expect(page.locator('.task-editor')).toHaveCount(0);
}

/** 等待保存后收起 */
export async function saveAndCollapse(page: Page) {
  await waitSaved(page);
  await collapse(page);
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

/** 侧边栏上区（单选）：总览 / 收藏（链接名后面跟着计数）；总览 = 清空分类选择 */
export const scopeItem = (page: Page, label: string) =>
  sidebar(page)
    .getByRole('region', { name: '范围' })
    .getByRole('link', { name: new RegExp(`^${label}`) });

export async function selectScope(page: Page, label: string) {
  await scopeItem(page, label).click();
  await expect(page.getByRole('heading', { level: 1, name: label })).toBeVisible();
}

/** 侧边栏"分类"区块中的分类开关（可多选累加） */
export const categoryToggle = (page: Page, name: string) =>
  sidebar(page)
    .getByRole('region', { name: '分类' })
    .getByRole('button', { name: new RegExp(`^${name}`) });

/** 切换某个分类的选中状态，并等待 URL / 按钮状态更新 */
export async function toggleCategory(page: Page, name: string) {
  const toggle = categoryToggle(page, name);
  const before = await toggle.getAttribute('aria-pressed');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');
}

/** 在侧边栏新建分类（颜色默认取调色板中第一个未被使用的）；创建后不改变当前的选择 */
export async function createCategory(page: Page, name: string) {
  await sidebar(page).getByRole('button', { name: '+ 新建分类' }).click();
  const form = page.getByRole('form', { name: '新建分类' });
  await form.getByLabel('分类名称').fill(name);
  await form.getByRole('button', { name: '添加分类' }).click();
  await expect(categoryToggle(page, name)).toBeVisible();
}

/** 清单 / 矩阵切换（LOGO 右边的图标按钮） */
export async function switchMode(page: Page, to: 'matrix' | 'list') {
  await sidebar(page)
    .getByRole('link', { name: to === 'matrix' ? '切换到矩阵' : '切换到清单' })
    .click();
  await expect(page).toHaveURL(to === 'matrix' ? /\/matrix/ : /localhost:\d+\/(\?|$)/);
}
