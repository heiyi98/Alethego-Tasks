import { expect, test, type Page } from '@playwright/test';

import {
  createCategory,
  editPanel,
  categoryItem,
  openTask,
  queryRest,
  quickAdd,
  runId,
  selectStatus,
  selectCategory,
  sidebar,
  taskItem,
} from './helpers';

const randomColor = () =>
  `#${Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, '0')}`;

const categoriesRegion = (page: Page) => sidebar(page).getByRole('region', { name: '个人' });

async function editCategory(page: Page, name: string) {
  await categoriesRegion(page)
    .getByRole('button', { name: `编辑分类「${name}」` })
    .click();
  const form = page.getByRole('form', { name: `编辑分类「${name}」` });
  await expect(form).toBeVisible();
  return form;
}

test('新建分类可以手动选择颜色；颜色可以和别的分类相同', async ({ page }) => {
  const id = runId();
  await page.goto('/');

  // 铅笔图标一直显示（不靠悬停）
  const anyEdit = categoriesRegion(page).getByRole('button', { name: /^编辑分类「/ });
  if ((await anyEdit.count()) > 0) {
    await expect(anyEdit.first()).toBeVisible();
    await expect(anyEdit.first()).toHaveCSS('opacity', '1');
  }

  // 手动选一个调色板颜色
  await sidebar(page).getByRole('button', { name: '+ 新建分类' }).click();
  const form = page.getByRole('form', { name: '新建分类' });
  await form.getByLabel('分类名称', { exact: true }).fill(`${id}甲`);
  const chosen = '#AF52DE';
  await form.getByRole('radio', { name: chosen }).click();
  await expect(form.getByRole('radio', { name: chosen })).toHaveAttribute('aria-checked', 'true');
  await form.getByRole('button', { name: '添加分类' }).click();
  await expect(categoryItem(page, `${id}甲`)).toBeVisible();

  // 再新建时：用过的颜色照样能选，没有任何提示
  await sidebar(page).getByRole('button', { name: '+ 新建分类' }).click();
  const form2 = page.getByRole('form', { name: '新建分类' });
  const taken = form2.getByRole('radio', { name: chosen });
  await expect(taken).toBeEnabled();
  await expect(taken).not.toHaveAttribute('title', /.*/);
  await form2.getByLabel('分类名称', { exact: true }).fill(`${id}乙`);
  await form2.getByLabel('自选颜色').fill(chosen.toLowerCase());
  await expect(form2.getByRole('alert')).toHaveCount(0);
  await form2.getByRole('button', { name: '添加分类' }).click();
  await expect(categoryItem(page, `${id}乙`)).toBeVisible();
});

test('编辑分类：名称、描述、颜色（可以和别的分类相同）；描述只在编辑表单里显示', async ({
  page,
  request,
}) => {
  const id = runId();
  const first = `${id}甲`;
  const second = `${id}乙`;
  await page.goto('/');
  await createCategory(page, first);
  await createCategory(page, second);

  const [firstRow] = await queryRest<{ id: string; color: string }[]>(
    request,
    `categories?name=eq.${encodeURIComponent(first)}&select=id,color`,
  );

  const form = await editCategory(page, second);
  // 选到「甲」的颜色：可以，不提示
  await form.getByLabel('自选颜色').fill(firstRow!.color.toLowerCase());
  await expect(form.getByRole('alert')).toHaveCount(0);
  await expect(form.getByRole('button', { name: '保存分类' })).toBeEnabled();

  const newColor = randomColor().toUpperCase();
  await form.getByLabel('自选颜色').fill(newColor.toLowerCase());
  await form.getByLabel('分类名称', { exact: true }).fill(`${second}改`);
  await form.getByLabel('分类描述').fill('周末的家务');
  await form.getByRole('button', { name: '保存分类' }).click();
  await expect(form).toHaveCount(0);

  // 没有悬停提示：描述不出现在标题栏、侧边栏或页面上，只在编辑表单里（侧边栏的铅笔）
  await selectCategory(page, `${second}改`);
  await expect(page.locator('h1.title-bar')).not.toHaveAttribute('title', /.*/);
  await expect(categoryItem(page, `${second}改`)).not.toHaveAttribute('title', /.*/);
  await expect(page.getByRole('main')).not.toContainText('周末的家务');
  await expect(sidebar(page)).not.toContainText('周末的家务');
  const reopened = await editCategory(page, `${second}改`);
  await expect(reopened.getByLabel('分类描述')).toHaveValue('周末的家务');
  await reopened.getByRole('button', { name: '取消' }).click();

  const [saved] = await queryRest<{ name: string; description: string; color: string }[]>(
    request,
    `categories?name=eq.${encodeURIComponent(`${second}改`)}&select=name,description,color`,
  );
  expect(saved).toEqual({ name: `${second}改`, description: '周末的家务', color: newColor });

  // 空名称不能保存；✕ 取消不改动
  const again = await editCategory(page, `${second}改`);
  await again.getByLabel('分类名称', { exact: true }).fill('  ');
  await again.getByRole('button', { name: '保存分类' }).click();
  await expect(again).toContainText('请输入分类名称');
  await again.getByRole('button', { name: '取消' }).click();
  await expect(
    categoriesRegion(page).getByRole('link', { name: new RegExp(`^${second}改`) }),
  ).toBeVisible();
});

test('删除分类：图标确认框说明任务保留；取消不删；确认后任务保留、只解除关联', async ({
  page,
  request,
}) => {
  const id = runId();
  const category = `${id}要删`;
  const title = `${id} 分类里的任务`;
  await page.goto('/');
  await createCategory(page, category);
  await selectCategory(page, category);
  await quickAdd(page, title);
  await expect(taskItem(page, title)).toContainText(category);

  // 取消：分类仍在
  const form = await editCategory(page, category);
  await form.getByRole('button', { name: '删除分类' }).click();
  const dialog = page.getByRole('alertdialog', { name: `删除分类「${category}」？` });
  await expect(dialog).toContainText('任务会保留，只是不再属于这个分类');
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(form).toBeVisible();

  // 确认：分类消失；正在看的就是这个分类时回到总览
  await form.getByRole('button', { name: '删除分类' }).click();
  await dialog.getByRole('button', { name: '删除分类' }).click();
  await expect(categoryItem(page, category)).toHaveCount(0);
  await expect(page).not.toHaveURL(/cat=/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('总览');

  // 任务保留，不再属于任何分类
  await selectStatus(page, '全部');
  await expect(taskItem(page, title)).toBeVisible();
  await expect(taskItem(page, title)).not.toContainText(category);
  const taskId = await openTask(page, title);
  await expect(editPanel(page).getByRole('button', { name: category })).toHaveCount(0);
  const [task] = await queryRest<{ deleted_at: string | null }[]>(
    request,
    `tasks?id=eq.${taskId}&select=deleted_at`,
  );
  expect(task!.deleted_at).toBeNull();
  expect(await queryRest<unknown[]>(request, `task_categories?task_id=eq.${taskId}`)).toEqual([]);
});
