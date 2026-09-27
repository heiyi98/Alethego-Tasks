import { expect, type Page } from '@playwright/test';

export const TIME_ZONE = 'Asia/Shanghai';

/** 每个用例的随机前缀，用于在共享数据库中隔离数据 */
export function runId(): string {
  return `e2e${Math.random().toString(36).slice(2, 8)}`;
}

/** 距今 offsetDays 天、指定时刻的 datetime-local 值（按 TIME_ZONE） */
export function localDateTime(offsetDays: number, time: string): string {
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
  return `${parts.year}-${parts.month}-${parts.day}T${time}`;
}

export async function quickAdd(page: Page, title: string) {
  const input = page.getByLabel('快速添加任务');
  await input.fill(title);
  await input.press('Enter');
  await expect(page.getByRole('link', { name: title })).toBeVisible();
}

/** 列表中以 prefix 开头的任务标题，按显示顺序 */
async function listedTitles(page: Page, prefix: string): Promise<string[]> {
  const all = await page.locator('.task-list .task-title').allTextContents();
  return all.filter((t) => t.startsWith(prefix));
}

/** 断言列表中本用例的任务及其顺序（等待筛选切换后的重新渲染） */
export async function expectTitles(page: Page, prefix: string, expected: string[]) {
  await expect.poll(() => listedTitles(page, prefix)).toEqual(expected);
}

export async function openTask(page: Page, title: string) {
  await page.getByRole('link', { name: title }).click();
  await expect(page.getByRole('form', { name: '任务详情' })).toBeVisible();
}

export async function saveAndBack(page: Page) {
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('status')).toHaveText('已保存');
  await page.getByRole('link', { name: '← 返回列表' }).click();
  await expect(page.getByLabel('快速添加任务')).toBeVisible();
}

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
  await page.getByLabel('新分类名称').fill(name);
  await page.getByRole('form', { name: '新建分类' }).getByRole('button', { name: '添加' }).click();
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
