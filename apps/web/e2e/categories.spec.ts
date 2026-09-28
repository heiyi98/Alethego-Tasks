import { expect, test, type Page } from '@playwright/test';

import {
  createCategory,
  editPanel,
  categoryToggle,
  openTask,
  queryRest,
  quickAdd,
  runId,
  selectStatus,
  toggleCategory,
  sidebar,
  taskItem,
} from './helpers';

const randomColor = () =>
  `#${Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, '0')}`;

const categoriesRegion = (page: Page) => sidebar(page).getByRole('region', { name: '分类' });

async function editCategory(page: Page, name: string) {
  await categoriesRegion(page)
    .getByRole('button', { name: `编辑分类「${name}」` })
    .click();
  const form = page.getByRole('form', { name: `编辑分类「${name}」` });
  await expect(form).toBeVisible();
  return form;
}

test('新建分类可以手动选择颜色；同一用户的分类颜色不能重复', async ({ page }) => {
  const id = runId();
  await page.goto('/');

  // 手动选一个颜色（调色板中尚未被占用的最后一个；调色板用尽时改用自选颜色）
  await sidebar(page).getByRole('button', { name: '+ 新建分类' }).click();
  const form = page.getByRole('form', { name: '新建分类' });
  await form.getByLabel('分类名称').fill(`${id}甲`);
  const free = form.locator('button[role="radio"]:not([disabled])');
  let chosen: string;
  if ((await free.count()) > 0) {
    chosen = (await free.last().getAttribute('aria-label'))!;
    await free.last().click();
    await expect(form.getByRole('radio', { name: chosen })).toHaveAttribute('aria-checked', 'true');
  } else {
    chosen = randomColor().toUpperCase();
    await form.getByLabel('自选颜色').fill(chosen.toLowerCase());
  }
  await form.getByRole('button', { name: '添加分类' }).click();
  await expect(categoryToggle(page, `${id}甲`)).toBeVisible();

  // 再新建时：若选的是调色板颜色，它已不可选
  await sidebar(page).getByRole('button', { name: '+ 新建分类' }).click();
  const form2 = page.getByRole('form', { name: '新建分类' });
  const taken = form2.getByRole('radio', { name: new RegExp(`^${chosen}`) });
  if ((await taken.count()) > 0) {
    await expect(taken).toBeDisabled();
    await expect(taken).toHaveAttribute('title', `已被「${id}甲」使用`);
  }

  // 自选颜色撞色（大小写不同也算）→ 立即提示，不能创建
  await form2.getByLabel('分类名称').fill(`${id}乙`);
  await form2.getByLabel('自选颜色').fill(chosen.toLowerCase());
  await expect(form2.getByRole('alert')).toHaveText(`该颜色已被「${id}甲」使用，请换一个`);
  await expect(form2.getByRole('button', { name: '添加分类' })).toBeDisabled();

  // 自选一个未被使用的颜色 → 提示消失，创建成功
  await form2.getByLabel('自选颜色').fill(randomColor());
  await expect(form2.getByRole('alert')).toHaveCount(0);
  await form2.getByRole('button', { name: '添加分类' }).click();
  await expect(categoryToggle(page, `${id}乙`)).toBeVisible();
});

test('编辑分类：名称、描述、颜色；撞色提示；描述显示在分类页', async ({ page, request }) => {
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
  // 自己当前的颜色不算撞色
  await expect(form.getByRole('alert')).toHaveCount(0);

  // 选到「甲」的颜色：立即提示，不能保存
  await form.getByLabel('自选颜色').fill(firstRow!.color.toLowerCase());
  await expect(form.getByRole('alert')).toHaveText(`该颜色已被「${first}」使用，请换一个`);
  await expect(form.getByRole('button', { name: '保存分类' })).toBeDisabled();

  const newColor = randomColor().toUpperCase();
  await form.getByLabel('自选颜色').fill(newColor.toLowerCase());
  await form.getByLabel('分类名称').fill(`${second}改`);
  await form.getByLabel('分类描述').fill('周末的家务');
  await form.getByRole('button', { name: '保存分类' }).click();
  await expect(form).toHaveCount(0);

  // 标题栏胶囊与侧边栏分类开关的悬停提示都是描述
  await toggleCategory(page, `${second}改`);
  await expect(
    page.getByTestId('title-capsule').getByRole('button', { name: `${second}改`, exact: true }),
  ).toHaveAttribute('title', '周末的家务');
  await expect(categoryToggle(page, `${second}改`)).toHaveAttribute('title', '周末的家务');
  await toggleCategory(page, first);
  await toggleCategory(page, first);

  const [saved] = await queryRest<{ name: string; description: string; color: string }[]>(
    request,
    `categories?name=eq.${encodeURIComponent(`${second}改`)}&select=name,description,color`,
  );
  expect(saved).toEqual({ name: `${second}改`, description: '周末的家务', color: newColor });

  // 空名称不能保存；✕ 取消不改动
  const again = await editCategory(page, `${second}改`);
  await again.getByLabel('分类名称').fill('  ');
  await again.getByRole('button', { name: '保存分类' }).click();
  await expect(again).toContainText('请输入分类名称');
  await again.getByRole('button', { name: '取消' }).click();
  await expect(
    categoriesRegion(page).getByRole('button', { name: new RegExp(`^${second}改`) }),
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
  await toggleCategory(page, category);
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

  // 确认：分类消失，并从当前选择中去掉（回到所有分类）
  await form.getByRole('button', { name: '删除分类' }).click();
  await dialog.getByRole('button', { name: '删除分类' }).click();
  await expect(categoryToggle(page, category)).toHaveCount(0);
  await expect(page).not.toHaveURL(/cat=/);
  await expect(page.getByTestId('title-capsule')).toHaveCount(0);
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
