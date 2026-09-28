import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  collapse,
  dateInput,
  editPanel,
  openTask,
  pickImportance,
  queryRest,
  quickAdd,
  runId,
  selectStatus,
  switchMode,
  taskItem,
  waitSaved,
} from './helpers';

const rule = (page: Page) => page.getByRole('group', { name: '重复规则' });
const history = (page: Page) => editPanel(page).getByRole('group', { name: '历史' });
const historyRows = (page: Page) => history(page).locator('.history-row-inline');

/** 固定浏览器时钟：2026-10-05 是周一 */
const MONDAY_1554 = new Date('2026-10-05T15:54:00+08:00');

async function patchTask(request: APIRequestContext, taskId: string, body: object) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const response = await request.patch(`${url}/rest/v1/tasks?id=eq.${taskId}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Profile': 'taskapp',
      'Content-Type': 'application/json',
    },
    data: body,
  });
  expect(response.ok()).toBe(true);
}

test('循环任务：代表实例按时刻切换；过点未勾选立刻记为未完成；历史嵌在面板里可勾选、可展开；永不进逾期区', async ({
  page,
  request,
}) => {
  await page.clock.setFixedTime(MONDAY_1554);
  const id = runId();
  const title = `${id} 每天喝水`;
  await page.goto('/');
  await quickAdd(page, title);
  const taskId = await openTask(page, title);
  const panel = editPanel(page);

  // 打开开关：截止日期与"标记完成"让位给重复规则
  await expect(dateInput(panel)).toBeVisible();
  await panel.getByRole('switch', { name: '重复' }).check();
  await expect(dateInput(panel)).toHaveCount(0);

  // 频率只有"天"和"周"
  await expect(rule(page).getByLabel('重复频率').locator('option')).toHaveText(['天', '周']);
  await rule(page).getByLabel('重复频率').selectOption('daily');
  await rule(page).getByLabel('开始时间').fill('2026-10-02T09:00');
  await pickImportance(panel, 4);
  await waitSaved(page);

  // 规则描述与"当前实例"那一行已删除
  await expect(panel.getByTestId('recurrence-summary')).toHaveCount(0);
  await expect(panel).not.toContainText('当前实例');

  // 历史：时刻已过的 10/2、10/3、10/4、10/5 09:00 都没勾选 → 立刻记为未完成；默认显示最近两次
  await expect(historyRows(page)).toHaveText(['10月5日 周一 09:00', '10月4日 周日 09:00']);
  for (const box of await historyRows(page).getByRole('checkbox').all()) {
    await expect(box).not.toBeChecked();
  }
  // 向下三角：展开后更高，显示更早的记录；再点收起，三角随之翻转
  const toggle = history(page).getByRole('button', { name: '展开历史' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  const collapseToggle = history(page).getByRole('button', { name: '收起历史' });
  await expect(collapseToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(collapseToggle.locator('svg')).toHaveCSS('transform', /matrix\(-1, .*-1, 0, 0\)/);
  await expect(historyRows(page)).toHaveCount(4);
  const rowH = (await historyRows(page).first().boundingBox())!.height;
  const listH = (await history(page).locator('.history-rows').boundingBox())!.height;
  expect(Math.round(listH / rowH)).toBe(4);
  await collapseToggle.click();
  await expect(historyRows(page)).toHaveCount(2);

  // 事后补登记：10/4 其实做了
  const oct4 = history(page).getByRole('checkbox', { name: '完成：10月4日 周日 09:00' });
  await oct4.click();
  await expect(oct4).toBeChecked();
  await expect
    .poll(async () => {
      const rows = await queryRest<{ occurrence_date: string; status: string }[]>(
        request,
        `recurrence_occurrences?task_id=eq.${taskId}&order=occurrence_date`,
      );
      return rows.map((r) => r.status);
    })
    .toEqual(['missed', 'missed', 'completed', 'missed']);
  await collapse(page);

  // 代表实例 = 时刻还没过的最早未完成实例：今天 09:00 已过 → 明天 10/6 09:00
  const row = taskItem(page, title);
  await expect(row.locator('.task-deadline')).toHaveText('本次 10月6日 周二 09:00 · 还剩1天');

  // 矩阵：N = 2 → "2天–1天"那一格；循环任务永远不进逾期区
  await switchMode(page, 'matrix');
  const dot = page.locator(`.matrix-node[aria-label^="${title}，"]`);
  await expect(dot).toHaveAttribute('data-column', '11');
  await expect(dot).toHaveAttribute('data-row', '4');
  await expect(dot).not.toHaveAttribute('data-overdue-lane', /.*/);

  // 清单里勾选完成的是"本次"，任务本身不完成，代表顺延到后天
  await switchMode(page, 'list');
  await page.getByRole('checkbox', { name: `完成本次：${title}` }).click();
  await expect(row.locator('.task-deadline')).toHaveText('本次 10月7日 周三 09:00 · 还剩2天');
  const [taskRow] = await queryRest<{ completed_at: string | null }[]>(
    request,
    `tasks?id=eq.${taskId}&select=completed_at`,
  );
  expect(taskRow!.completed_at).toBeNull();

  // 关闭循环：任务恢复为普通任务，历史记录保留
  await openTask(page, title);
  await panel.getByRole('switch', { name: '重复' }).uncheck();
  await expect(dateInput(panel)).toBeVisible();
  await waitSaved(page);
  const records = await queryRest<unknown[]>(
    request,
    `recurrence_occurrences?task_id=eq.${taskId}`,
  );
  expect(records).toHaveLength(5);
});

test('循环任务：当前实例一过它的时刻，代表立刻换成下一次（不等到午夜），上一次记为未完成', async ({
  page,
}) => {
  await page.clock.setFixedTime(MONDAY_1554);
  const id = runId();
  const title = `${id} 四点吃药`;
  await page.goto('/');
  await quickAdd(page, title);
  await openTask(page, title);
  const panel = editPanel(page);
  await panel.getByRole('switch', { name: '重复' }).check();
  await rule(page).getByLabel('重复频率').selectOption('daily');
  await rule(page).getByLabel('开始时间').fill('2026-10-05T16:00');
  await pickImportance(panel, 3);
  await waitSaved(page);
  await collapse(page);

  // 15:54：今天 16:00 的实例还没到时刻 → 它就是代表（N = 1，最右的普通格）
  const row = taskItem(page, title);
  await expect(row.locator('.task-deadline')).toHaveText('本次 今天 16:00');
  await switchMode(page, 'matrix');
  const dot = page.locator(`.matrix-node[aria-label^="${title}，"]`);
  await expect(dot).toHaveAttribute('data-column', '12');

  // 16:01：代表立刻换成明天 16:00；今天 16:00 进入历史，记为未完成
  await page.clock.setFixedTime(new Date('2026-10-05T16:01:00+08:00'));
  await page.reload();
  await expect(dot).toHaveAttribute('data-column', '11');
  await expect(dot).not.toHaveAttribute('data-overdue-lane', /.*/);
  await switchMode(page, 'list');
  await selectStatus(page, '未完成');
  await expect(row.locator('.task-deadline')).toHaveText('本次 10月6日 周二 16:00 · 还剩1天');
  await openTask(page, title);
  await expect(historyRows(page)).toHaveText(['10月5日 周一 16:00']);
  await expect(history(page).getByRole('checkbox')).not.toBeChecked();
});

test('重复规则编辑：每 N 天 / 每 N 周与星期、次数；非法规则不能保存；库里的每月规则数据不动', async ({
  page,
  request,
}) => {
  const id = runId();
  const title = `${id} 规则编辑`;
  await page.goto('/');
  await quickAdd(page, title);
  const taskId = await openTask(page, title);
  const panel = editPanel(page);

  await panel.getByRole('switch', { name: '重复' }).check();
  await rule(page).getByLabel('开始时间').fill('2026-10-06T19:30');

  // 每周：清空所有星期 → 提示错误，不保存
  await rule(page).getByLabel('重复频率').selectOption('weekly');
  const weekdays = rule(page).getByRole('group', { name: '星期' });
  for (const name of ['周一', '周二', '周三', '周四', '周五', '周六', '周日']) {
    const button = weekdays.getByRole('button', { name });
    if ((await button.getAttribute('aria-pressed')) === 'true') await button.click();
  }
  await expect(panel).toContainText('请至少选择一个星期几');
  await expect(panel).toHaveAttribute('data-save-state', 'invalid');

  // 每 2 周的一、三、五，共 5 次
  for (const name of ['周一', '周三', '周五']) await weekdays.getByRole('button', { name }).click();
  await rule(page).getByLabel('重复间隔').fill('2');
  await rule(page).getByLabel('结束方式').selectOption('count');
  await rule(page).getByLabel('重复次数').fill('5');
  await waitSaved(page);
  // 没有月、年的界面
  await expect(rule(page).getByRole('group', { name: '日期' })).toHaveCount(0);
  await expect(rule(page).getByRole('button', { name: '最后一天' })).toHaveCount(0);

  const [saved] = await queryRest<{ recurrence_rule: string }[]>(
    request,
    `tasks?id=eq.${taskId}&select=recurrence_rule`,
  );
  expect(saved!.recurrence_rule).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;COUNT=5');
  await collapse(page);
  await expect(taskItem(page, title)).toContainText('↻ 每 2 周的周一、三、五，共 5 次');

  // 刷新后重新展开，规则能被正确读回
  await page.reload();
  await openTask(page, title);
  await expect(rule(page).getByLabel('重复间隔')).toHaveValue('2');
  await expect(weekdays.getByRole('button', { name: '周三' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await collapse(page);

  // 库里已有的每月规则：数据不动，引擎照常计算，编辑器按"超出可编辑范围的规则"处理
  await patchTask(request, taskId, { recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=1' });
  await page.reload();
  await expect(taskItem(page, title).locator('.task-deadline')).toContainText('本次');
  await openTask(page, title);
  await expect(rule(page)).toContainText('FREQ=MONTHLY;BYMONTHDAY=1');
  await expect(rule(page).getByLabel('重复频率')).toHaveCount(0);
  await collapse(page);
  const [still] = await queryRest<{ recurrence_rule: string }[]>(
    request,
    `tasks?id=eq.${taskId}&select=recurrence_rule`,
  );
  expect(still!.recurrence_rule).toBe('FREQ=MONTHLY;BYMONTHDAY=1');
});
