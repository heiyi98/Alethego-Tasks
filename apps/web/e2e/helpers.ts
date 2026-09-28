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

export const quickAddBar = (page: Page) => page.locator('form.quick-add');

/** 在一组"重要性"按钮中选择 level */
export async function pickImportance(scope: Locator, level: number) {
  await scope
    .getByRole('group', { name: '重要性' })
    .getByRole('button', { name: `重要性 ${level}`, exact: true })
    .click();
}

export const dateInput = (scope: Locator) => scope.locator('input[aria-label="截止日期"]');

/** 快速添加：可同时设置重要性与截止日期（YYYY-MM-DD），回车创建 */
export async function quickAdd(
  page: Page,
  title: string,
  options: { importance?: number; deadline?: string; expectVisible?: boolean } = {},
) {
  const bar = quickAddBar(page);
  const input = page.getByLabel('快速添加任务');
  await input.fill(title);
  if (options.importance !== undefined) await pickImportance(bar, options.importance);
  if (options.deadline) await dateInput(bar).fill(options.deadline);
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

/** 在列表中点击任务，原地展开编辑面板；返回任务 id */
export async function openTask(page: Page, title: string): Promise<string> {
  const main = taskItem(page, title).locator('.task-main').first();
  await main.click();
  await expect(main).toHaveAttribute('aria-expanded', 'true');
  await expect(editPanel(page).getByLabel('标题')).toHaveValue(title);
  return (await main.getAttribute('data-task-id'))!;
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

/** 侧边栏"总览"区块：全部 / 未完成 / 已完成 / 已错过（链接名后面跟着计数） */
export async function selectStatus(page: Page, label: string) {
  await sidebar(page)
    .getByRole('region', { name: '总览' })
    .getByRole('link', { name: new RegExp(`^${label}`) })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: label })).toBeVisible();
}

/** 在侧边栏新建分类（颜色默认取调色板中第一个未被使用的）；创建后会进入该分类页 */
export async function createCategory(page: Page, name: string) {
  await sidebar(page).getByRole('button', { name: '+ 新建分类' }).click();
  const form = page.getByRole('form', { name: '新建分类' });
  await form.getByLabel('分类名称').fill(name);
  await form.getByRole('button', { name: '添加分类' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

/** 侧边栏"分类"区块中的某个分类 */
export async function openCategory(page: Page, name: string) {
  await sidebar(page)
    .getByRole('region', { name: '分类' })
    .getByRole('link', { name: new RegExp(`^${name}`) })
    .click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}
