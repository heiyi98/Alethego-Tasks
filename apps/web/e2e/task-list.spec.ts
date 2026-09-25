import { expect, test } from '@playwright/test';

import {
  expectTitles,
  localDateTime,
  openTask,
  quickAdd,
  runId,
  saveAndBack,
  selectStatus,
} from './helpers';

test('快速添加、编辑截止时间与重要性、按截止时间排序、状态筛选、完成任务', async ({ page }) => {
  const id = runId();
  const t = (name: string) => `${id} ${name}`;
  await page.goto('/');

  for (const name of ['无截止', '下周', '明天', '已过期']) await quickAdd(page, t(name));

  // 新建任务只有标题：默认待办、无截止时间，按创建时间倒序
  await expectTitles(page, id, [t('已过期'), t('明天'), t('下周'), t('无截止')]);

  await openTask(page, t('明天'));
  await page.getByLabel('截止时间').fill(localDateTime(1, '09:00'));
  await page.getByRole('group', { name: '重要性' }).getByRole('button', { name: '4' }).click();
  await saveAndBack(page);

  await openTask(page, t('下周'));
  await page.getByLabel('截止时间').fill(localDateTime(7, '18:00'));
  await saveAndBack(page);

  await openTask(page, t('已过期'));
  await page.getByLabel('截止时间').fill(localDateTime(-1, '09:00'));
  await saveAndBack(page);

  // 默认视图 = 待办：截止时间从近到远，无截止时间排最后；已过期的不在待办中
  await expectTitles(page, id, [t('明天'), t('下周'), t('无截止')]);
  const tomorrowRow = page.locator('.task-row', { hasText: t('明天') });
  await expect(tomorrowRow).toContainText('明天 09:00');
  await expect(tomorrowRow).toContainText('重要性 4');

  await selectStatus(page, '已错过');
  await expectTitles(page, id, [t('已过期')]);
  await expect(page.locator('.task-row', { hasText: t('已过期') })).toContainText('已错过');

  // 完成任务后离开待办，出现在已完成
  await selectStatus(page, '待办');
  // 待办视图中勾选后任务立即离开列表，因此用 click 而不是 check
  await page.getByRole('checkbox', { name: `完成：${t('明天')}` }).click();
  await expect(page.getByRole('link', { name: t('明天') })).toHaveCount(0);
  await selectStatus(page, '已完成');
  await expectTitles(page, id, [t('明天')]);

  await selectStatus(page, '全部');
  await expectTitles(page, id, [t('已过期'), t('明天'), t('下周'), t('无截止')]);

  // 筛选条件保存在 URL 中，刷新后保持
  await expect(page).toHaveURL(/status=all/);
  await page.reload();
  await expectTitles(page, id, [t('已过期'), t('明天'), t('下周'), t('无截止')]);

  // 完成状态已写入数据库
  await selectStatus(page, '已完成');
  await expectTitles(page, id, [t('明天')]);
});

test('分类：新建、在详情中多选、列表多选筛选（命中即显示）', async ({ page }) => {
  const id = runId();
  const t = (name: string) => `${id} ${name}`;
  const work = `${id}工作`;
  const home = `${id}家庭`;
  await page.goto('/');

  const categoryBar = page.getByRole('group', { name: '分类筛选' });
  for (const name of [work, home]) {
    await categoryBar.getByRole('button', { name: '+ 新建分类' }).click();
    await page.getByLabel('新分类名称').fill(name);
    await page.getByLabel('新分类名称').press('Enter');
    await expect(categoryBar.getByRole('button', { name })).toBeVisible();
  }

  for (const name of ['只工作', '工作和家庭', '无分类']) await quickAdd(page, t(name));

  await openTask(page, t('只工作'));
  await page.getByRole('group', { name: '分类' }).getByRole('button', { name: work }).click();
  await saveAndBack(page);

  await openTask(page, t('工作和家庭'));
  const detailCategories = page.getByRole('group', { name: '分类' });
  await detailCategories.getByRole('button', { name: work }).click();
  await detailCategories.getByRole('button', { name: home }).click();
  await saveAndBack(page);

  await expect(page.locator('.task-row', { hasText: t('工作和家庭') })).toContainText(home);

  await categoryBar.getByRole('button', { name: home }).click();
  await expectTitles(page, id, [t('工作和家庭')]);

  await categoryBar.getByRole('button', { name: work }).click();
  await expectTitles(page, id, [t('工作和家庭'), t('只工作')]);

  // 从详情返回后保持筛选
  await openTask(page, t('只工作'));
  await page.getByRole('link', { name: '← 返回列表' }).click();
  await expect(categoryBar.getByRole('button', { name: work })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expectTitles(page, id, [t('工作和家庭'), t('只工作')]);

  await categoryBar.getByRole('button', { name: work }).click();
  await categoryBar.getByRole('button', { name: home }).click();
  await expectTitles(page, id, [t('无分类'), t('工作和家庭'), t('只工作')]);
});

test('删除为软删除：列表与详情不可见，数据库中保留并带 deleted_at', async ({ page, request }) => {
  const id = runId();
  const title = `${id} 要删除`;
  await page.goto('/');
  await quickAdd(page, title);
  await openTask(page, title);
  const taskUrl = page.url();
  const taskId = taskUrl.split('/tasks/')[1]!;

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '删除' }).click();
  await expect(page.getByLabel('快速添加任务')).toBeVisible();
  await expect(page.getByRole('link', { name: title })).toHaveCount(0);

  await page.goto(taskUrl);
  await expect(page.getByText('任务不存在或已删除。')).toBeVisible();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const response = await request.get(
    `${url}/rest/v1/tasks?id=eq.${taskId}&select=title,deleted_at`,
    {
      // 业务表在 taskapp schema 中，通过 Accept-Profile 指定
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Accept-Profile': 'taskapp' },
    },
  );
  const rows = (await response.json()) as { title: string; deleted_at: string | null }[];
  expect(rows).toHaveLength(1);
  expect(rows[0]!.title).toBe(title);
  expect(rows[0]!.deleted_at).not.toBeNull();
});

test('空白标题：快速添加忽略，详情中保存报错', async ({ page }) => {
  const id = runId();
  await page.goto('/');
  const input = page.getByLabel('快速添加任务');
  await input.fill('   ');
  await input.press('Enter');
  await expect(input).toHaveValue('   ');

  await quickAdd(page, `  ${id} 有空格  `);
  await openTask(page, `${id} 有空格`);
  await expect(page.getByLabel('标题')).toHaveValue(`${id} 有空格`);
  await page.getByLabel('标题').fill('   ');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('status')).toHaveText('标题不能为空');
});
