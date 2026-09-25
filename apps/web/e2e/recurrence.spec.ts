import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { localDateTime, openTask, quickAdd, runId } from './helpers';

/** 直接查询数据库（taskapp schema）验证落库结果 */
async function queryRest<T>(request: APIRequestContext, path: string): Promise<T> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const response = await request.get(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Accept-Profile': 'taskapp' },
  });
  return (await response.json()) as T;
}

const rule = (page: Page) => page.getByRole('group', { name: '重复规则' });
const summary = (page: Page) => page.getByTestId('recurrence-summary');

async function save(page: Page) {
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('status')).toHaveText('已保存');
}

test('循环开关：每天重复；勾选完成当前实例而非任务本身；历史记录可手动修改；关闭后记录保留', async ({
  page,
  request,
}) => {
  const id = runId();
  const title = `${id} 每天喝水`;
  await page.goto('/');
  await quickAdd(page, title);
  await openTask(page, title);
  const taskId = page.url().split('/tasks/')[1]!;

  // 打开开关：截止时间与"已完成"让位给重复规则
  await expect(page.getByLabel('截止时间')).toBeVisible();
  await page.getByRole('switch', { name: '重复' }).check();
  await expect(page.getByLabel('截止时间')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: '已完成' })).toHaveCount(0);

  await rule(page).getByLabel('重复频率').selectOption('daily');
  await rule(page).getByLabel('开始时间').fill(localDateTime(-3, '08:00'));
  await page
    .getByRole('group', { name: '重要性' })
    .getByRole('button', { name: '4', exact: true })
    .click();
  await expect(summary(page)).toContainText('每天');
  await expect(summary(page)).toContainText('当前实例');
  await save(page);

  // 保存后归档：3 天前、前天、昨天（未完成）+ 今天（待完成）
  await expect(page.getByRole('link', { name: '历史记录（4 次）→' })).toBeVisible();

  // 矩阵：代表实例是今天 → 最右侧的"今天"列
  await page.goto('/matrix');
  const dot = page.locator(`a.matrix-dot[aria-label^="${title}，"]`);
  await expect(dot).toHaveAttribute('data-column', '13');
  await expect(dot).toHaveAttribute('data-row', '4');

  // 列表：勾选完成的是"本次"，任务仍在待办中，代表实例顺延到明天
  await page.goto('/');
  const row = page.locator('.task-row', { hasText: title });
  await expect(row).toContainText('本次 今天 08:00');
  await expect(row).toContainText('↻ 每天');
  await page.getByRole('checkbox', { name: `完成本次：${title}` }).click();
  await expect(row).toContainText('本次 明天 08:00');

  const [taskRow] = await queryRest<{ completed_at: string | null }[]>(
    request,
    `tasks?id=eq.${taskId}&select=completed_at`,
  );
  expect(taskRow!.completed_at).toBeNull();

  await page.goto('/matrix');
  await expect(dot).toHaveAttribute('data-column', '12');

  // 历史记录：最新在前；今天已完成，之前 3 次未完成
  await page.goto(`/tasks/${taskId}/history`);
  const statuses = page.locator('.history-status');
  await expect(statuses).toHaveText(['已完成', '未完成', '未完成', '未完成']);
  await expect(page.getByText('共 4 次，完成 1 次')).toBeVisible();

  // 手动补登记前天"其实做了"
  const dayBefore = page.locator('.history-row').nth(2);
  await dayBefore.getByRole('button', { name: '完成', exact: true }).click();
  await expect(dayBefore.locator('.history-status')).toHaveText('已完成');
  await page.reload();
  await expect(statuses).toHaveText(['已完成', '未完成', '已完成', '未完成']);

  // 关闭循环：任务恢复为普通任务，历史记录保留
  await page.goto(`/tasks/${taskId}`);
  await page.getByRole('switch', { name: '重复' }).uncheck();
  await expect(page.getByLabel('截止时间')).toBeVisible();
  await save(page);
  await expect(page.getByRole('link', { name: '历史记录（4 次）→' })).toBeVisible();
  await page.getByRole('link', { name: '历史记录（4 次）→' }).click();
  await expect(page.getByText('循环已关闭，历史记录保留')).toBeVisible();
  await expect(statuses).toHaveCount(4);

  const records = await queryRest<unknown[]>(
    request,
    `recurrence_occurrences?task_id=eq.${taskId}`,
  );
  expect(records).toHaveLength(4);
});

test('重复规则编辑：每周几、每月几号与最后一天、次数；非法规则不能保存', async ({
  page,
  request,
}) => {
  const id = runId();
  const title = `${id} 规则编辑`;
  await page.goto('/');
  await quickAdd(page, title);
  await openTask(page, title);
  const taskId = page.url().split('/tasks/')[1]!;

  await page.getByRole('switch', { name: '重复' }).check();
  await rule(page).getByLabel('开始时间').fill(localDateTime(1, '19:30'));

  // 每周：清空所有星期 → 不能保存
  await rule(page).getByLabel('重复频率').selectOption('weekly');
  const weekdays = rule(page).getByRole('group', { name: '星期' });
  for (const name of ['周一', '周二', '周三', '周四', '周五', '周六', '周日']) {
    const button = weekdays.getByRole('button', { name });
    if ((await button.getAttribute('aria-pressed')) === 'true') await button.click();
  }
  await expect(summary(page)).toContainText('请至少选择一个星期几');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('status')).toHaveText('请至少选择一个星期几');

  for (const name of ['周一', '周三', '周五']) await weekdays.getByRole('button', { name }).click();
  await expect(summary(page)).toContainText('每周一、三、五');

  // 每月 1 号和最后一天，共 5 次
  await rule(page).getByLabel('重复频率').selectOption('monthly');
  const days = rule(page).getByRole('group', { name: '日期' });
  for (const name of await days.getByRole('button', { pressed: true }).allTextContents()) {
    await days.getByRole('button', { name: `${name}号`, exact: true }).click();
  }
  await days.getByRole('button', { name: '1号', exact: true }).click();
  await days.getByRole('button', { name: '最后一天' }).click();
  await rule(page).getByLabel('结束方式').selectOption('count');
  await rule(page).getByLabel('重复次数').fill('5');
  await expect(summary(page)).toContainText('每月1号和最后一天，共 5 次');
  await save(page);

  const [saved] = await queryRest<{ recurrence_rule: string }[]>(
    request,
    `tasks?id=eq.${taskId}&select=recurrence_rule`,
  );
  expect(saved!.recurrence_rule).toBe('FREQ=MONTHLY;BYMONTHDAY=1,-1;COUNT=5');

  // 重新打开页面，规则能被正确读回
  await page.reload();
  await expect(summary(page)).toContainText('每月1号和最后一天，共 5 次');

  // 列表中显示规则说明
  await page.goto('/');
  await expect(page.locator('.task-row', { hasText: title })).toContainText(
    '↻ 每月1号和最后一天，共 5 次',
  );
});
