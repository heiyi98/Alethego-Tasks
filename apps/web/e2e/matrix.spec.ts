import { expect, test, type Page } from '@playwright/test';

import { localDateTime, openTask, quickAdd, runId, saveAndBack } from './helpers';

/** 在详情页设置截止时间 / 重要性 / 分类 */
async function setupTask(
  page: Page,
  title: string,
  opts: { deadline?: string; importance?: number; category: string },
) {
  await openTask(page, title);
  if (opts.deadline) await page.getByLabel('截止时间').fill(opts.deadline);
  if (opts.importance !== undefined) {
    await page
      .getByRole('group', { name: '重要性' })
      .getByRole('button', { name: String(opts.importance), exact: true })
      .click();
  }
  await page
    .getByRole('group', { name: '分类' })
    .getByRole('button', { name: opts.category })
    .click();
  await saveAndBack(page);
}

const dot = (page: Page, title: string) => page.locator(`a.matrix-dot[aria-label^="${title}，"]`);

test('矩阵：按紧迫度 × 重要性放置，逾期贴边，远期与未处理不显示，象限列表，点击进入详情', async ({
  page,
}) => {
  const id = runId();
  const t = (name: string) => `${id} ${name}`;
  const category = `${id}矩阵`;

  await page.goto('/');
  const categoryBar = page.getByRole('group', { name: '分类筛选' });
  await categoryBar.getByRole('button', { name: '+ 新建分类' }).click();
  await page.getByLabel('新分类名称').fill(category);
  await page.getByLabel('新分类名称').press('Enter');
  await expect(categoryBar.getByRole('button', { name: category })).toBeVisible();

  const specs = [
    { name: '明天重要', deadline: localDateTime(1, '09:00'), importance: 5 },
    { name: '下月不重要', deadline: localDateTime(30, '09:00'), importance: 1 },
    { name: '无截止重要', importance: 4 },
    { name: '逾期两天', deadline: localDateTime(-2, '09:00'), importance: 2 },
    { name: '远期', deadline: localDateTime(500, '09:00'), importance: 3 },
    { name: '未处理' },
  ];
  for (const spec of specs) await quickAdd(page, t(spec.name));
  await page.getByRole('group', { name: '状态筛选' }).getByRole('button', { name: '全部' }).click();
  for (const { name, ...opts } of specs) await setupTask(page, t(name), { ...opts, category });

  // 进入矩阵，只点亮本用例的分类
  await page.getByRole('navigation', { name: '视图' }).getByRole('link', { name: '矩阵' }).click();
  await expect(page).toHaveURL(/\/matrix/);
  await page
    .getByRole('group', { name: '分类筛选' })
    .getByRole('button', { name: category })
    .click();
  await expect(page).toHaveURL(/cat=/);

  await expect(page.locator('a.matrix-dot')).toHaveCount(4);
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

  // 点击圆点进入详情
  await dot(page, t('明天重要')).click();
  await expect(page.getByLabel('标题')).toHaveValue(t('明天重要'));
});

test('矩阵：完成任务后从矩阵消失；分类未命中时不显示', async ({ page }) => {
  const id = runId();
  const title = `${id} 待完成`;
  const other = `${id}其他`;
  await page.goto('/');
  const categoryBar = page.getByRole('group', { name: '分类筛选' });
  await categoryBar.getByRole('button', { name: '+ 新建分类' }).click();
  await page.getByLabel('新分类名称').fill(other);
  await page.getByLabel('新分类名称').press('Enter');
  await expect(categoryBar.getByRole('button', { name: other })).toBeVisible();

  await quickAdd(page, title);
  await openTask(page, title);
  await page.getByLabel('截止时间').fill(localDateTime(2, '10:00'));
  await page
    .getByRole('group', { name: '重要性' })
    .getByRole('button', { name: '3', exact: true })
    .click();
  await saveAndBack(page);

  await page.goto('/matrix');
  await expect(dot(page, title)).toHaveCount(1);

  // 点亮一个该任务不属于的分类 → 不显示
  await page.getByRole('group', { name: '分类筛选' }).getByRole('button', { name: other }).click();
  await expect(dot(page, title)).toHaveCount(0);

  await page.goto('/');
  await page.getByRole('checkbox', { name: `完成：${title}` }).click();
  await expect(page.getByRole('link', { name: title })).toHaveCount(0);
  await page.goto('/matrix');
  await expect(page.getByRole('img', { name: /时间管理矩阵/ })).toBeVisible();
  await expect(dot(page, title)).toHaveCount(0);
});
