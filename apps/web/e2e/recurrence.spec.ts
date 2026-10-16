import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import {
  collapse,
  dateButton,
  editPanel,
  expectDate,
  localDate,
  openTask,
  pickDate,
  pickImportance,
  queryRest,
  quickAdd,
  runId,
  selectStatus,
  switchMode,
  taskItem,
  waitSaved,
  matrixAllPersonal,
} from './helpers';
import { accessTokenFor } from './auth';

const rule = (page: Page) => page.getByRole('group', { name: '重复规则' });
const history = (page: Page) => editPanel(page).getByRole('group', { name: '历史' });
const historyRows = (page: Page) => history(page).locator('.history-row-inline');
const secondRow = (page: Page) => editPanel(page).locator('.quick-options').first();
const radio = (scope: Locator, group: string, name: string) =>
  scope.getByRole('radiogroup', { name: group }).getByRole('radio', { name, exact: true });
const period = (page: Page, name: '日' | '周' | '月' | '年') =>
  radio(editPanel(page), '重复周期', name);

/** 让一组按钮里正好是 names 这几个按下 */
async function pressOnly(group: Locator, names: string[]) {
  for (const button of await group.getByRole('button').all()) {
    const name = (await button.getAttribute('aria-label')) ?? '';
    const pressed = (await button.getAttribute('aria-pressed')) === 'true';
    if (pressed !== names.includes(name)) await button.click();
  }
  for (const name of names) {
    await expect(group.getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }
}

/** 固定浏览器时钟：2026-10-05 是周一 */
const MONDAY_1554 = new Date('2026-10-05T15:54:00+08:00');

async function patchTask(request: APIRequestContext, taskId: string, body: object) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const token = await accessTokenFor();
  const response = await request.patch(`${url}/rest/v1/tasks?id=eq.${taskId}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      'Content-Profile': 'taskapp',
      'Content-Type': 'application/json',
    },
    data: body,
  });
  expect(response.ok()).toBe(true);
}

const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

/** "YYYY-MM-DD" → "10月12日 周一"（和历史里的写法一样，今年的不写年份） */
function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const year = y === Number(localDate(0).slice(0, 4)) ? '' : `${y}年`;
  return `${year}${m}月${d}日 周${WEEKDAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}`;
}

async function rpcAsMain<T = unknown>(
  request: APIRequestContext,
  fn: string,
  body: object,
): Promise<T> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const response = await request.post(`${url}/rest/v1/rpc/${fn}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${await accessTokenFor()}`,
      'Content-Profile': 'taskapp',
      'Content-Type': 'application/json',
    },
    data: body,
  });
  expect(response.ok(), await response.text()).toBe(true);
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** 直接写一条已完成的循环记录（例如提前完成以后的某一次） */
async function insertOccurrence(request: APIRequestContext, taskId: string, date: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const response = await request.post(`${url}/rest/v1/recurrence_occurrences`, {
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${await accessTokenFor()}`,
      'Content-Profile': 'taskapp',
      'Content-Type': 'application/json',
    },
    data: {
      task_id: taskId,
      occurrence_date: date,
      status: 'completed',
      completed_at: new Date().toISOString(),
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

const recordsOf = (request: APIRequestContext, taskId: string) =>
  queryRest<{ occurrence_date: string; status: string }[]>(
    request,
    `recurrence_occurrences?task_id=eq.${taskId}&order=occurrence_date&select=occurrence_date,status`,
  );

async function savedRule(request: APIRequestContext, taskId: string) {
  const [row] = await queryRest<{ recurrence_rule: string; recurrence_start_on: string }[]>(
    request,
    `tasks?id=eq.${taskId}&select=recurrence_rule,recurrence_start_on`,
  );
  return row!;
}

test('循环任务：开关右边是日周月年；开始日期就是第二行的日期；过去的那几次记为未完成；历史可勾选、可展开；永不进逾期区', async ({
  page,
  request,
}) => {
  await page.clock.setFixedTime(MONDAY_1554);
  const id = runId();
  const title = `${id} 每天喝水`;
  await page.goto('/');
  await selectStatus(page, '全部');
  await quickAdd(page, title, { deadline: '2026-10-02' });
  const taskId = await openTask(page, title);
  const panel = editPanel(page);

  // 打开开关：开关右边同一行是"日、周、月、年"，一个都不默认选中；第二行的日期留着，作为开始日期，不能清空
  await expect(panel.getByRole('radiogroup', { name: '重复周期' })).toHaveCount(0);
  const toggle = panel.getByRole('switch', { name: '重复' });
  await toggle.check();
  const periods = panel.getByRole('radiogroup', { name: '重复周期' });
  await expect(periods.getByRole('radio')).toHaveText(['日', '周', '月', '年']);
  for (const radioButton of await periods.getByRole('radio').all()) {
    await expect(radioButton).toHaveAttribute('aria-checked', 'false');
  }
  await expect(rule(page)).toHaveCount(0);
  // 没有结束条件
  await expect(panel.getByLabel('结束方式')).toHaveCount(0);
  const switchBox = (await panel.locator('.recurrence-head .switch').boundingBox())!;
  const periodsBox = (await periods.boundingBox())!;
  expect(
    Math.abs(switchBox.y + switchBox.height / 2 - (periodsBox.y + periodsBox.height / 2)),
  ).toBeLessThan(4);
  expect(periodsBox.x).toBeGreaterThan(switchBox.x + switchBox.width - 1);
  await expectDate(secondRow(page), '2026-10-02');
  await expect(secondRow(page).getByRole('button', { name: '清除截止时间' })).toHaveCount(0);

  await period(page, '日').click();
  await expect(rule(page).getByLabel('重复间隔')).toHaveValue('1');
  await pickImportance(panel, 3);
  await waitSaved(page);
  expect(await savedRule(request, taskId)).toEqual({
    recurrence_rule: 'FREQ=DAILY',
    recurrence_start_on: '2026-10-02',
  });

  // 第二行显示当前这一次：今天（10/5）还没过完
  await expectDate(secondRow(page), '2026-10-05');
  // 历史：已经过完的 10/2、10/3、10/4 没勾选 → 记为未完成；默认显示最近两次
  await expect(historyRows(page)).toHaveText(['10月4日 周日', '10月3日 周六']);
  for (const box of await historyRows(page).getByRole('checkbox').all()) {
    await expect(box).not.toBeChecked();
  }
  // 向下三角：展开后显示更早的记录；再点收起，三角随之翻转
  const expand = history(page).getByRole('button', { name: '展开历史' });
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expand.click();
  const collapseToggle = history(page).getByRole('button', { name: '收起历史' });
  await expect(collapseToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(collapseToggle.locator('svg')).toHaveCSS('transform', /matrix\(-1, .*-1, 0, 0\)/);
  await expect(historyRows(page)).toHaveCount(3);
  await collapseToggle.click();
  await expect(historyRows(page)).toHaveCount(2);

  // 事后补登记：10/4 其实做了
  const oct4 = history(page).getByRole('checkbox', { name: '完成：10月4日 周日' });
  const oct4Row = historyRows(page).filter({ hasText: '10月4日 周日' });
  const oct3Row = historyRows(page).filter({ hasText: '10月3日 周六' });
  // 没做的记录按"已错过"的样式显示：日期与已错过的任务一样标红
  await expect(oct4Row).toHaveClass(/task-missed/);
  const danger = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--danger)';
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect(oct4Row.locator('.task-deadline')).toHaveCSS('color', danger);
  await oct4.click();
  await expect(oct4).toBeChecked();
  await expect(oct4Row).toHaveClass(/task-completed/);
  await expect(oct4Row.locator('.task-title')).toHaveCSS('text-decoration-line', 'line-through');
  await expect(oct3Row).toHaveClass(/task-missed/);
  await expect
    .poll(async () => {
      const rows = await queryRest<{ occurrence_date: string; status: string }[]>(
        request,
        `recurrence_occurrences?task_id=eq.${taskId}&order=occurrence_date`,
      );
      return rows.map((r) => [r.occurrence_date, r.status]);
    })
    .toEqual([
      ['2026-10-02', 'missed'],
      ['2026-10-03', 'missed'],
      ['2026-10-04', 'completed'],
    ]);
  await collapse(page);

  // 列表：本次是今天；简介行一句话描述规则
  const row = taskItem(page, title);
  await expect(row.locator('.task-deadline')).toHaveText('本次 今天');
  await expect(row).toContainText('↻ 每天');

  // 矩阵（短期）：今天 → 最右的普通格；循环任务永远不进逾期区
  await switchMode(page, 'matrix');
  await matrixAllPersonal(page);
  const dot = page.locator(`.matrix-node[aria-label^="${title}，"]`);
  await expect(dot).toHaveAttribute('data-column', '5');

  // 清单里勾选完成的是"本次"，任务本身不完成，代表顺延到明天
  await switchMode(page, 'list');
  await page.getByRole('checkbox', { name: `完成本次：${title}` }).click();
  await expect(row.locator('.task-deadline')).toHaveText('本次 10月6日 周二 · 还剩1天');
  await expect(row).not.toHaveClass(/task-completed/);
  const [taskRow] = await queryRest<{ completed_at: string | null }[]>(
    request,
    `tasks?id=eq.${taskId}&select=completed_at`,
  );
  expect(taskRow!.completed_at).toBeNull();

  // 关闭循环：当前这一次（10/6）变成普通任务，历史记录保留
  await openTask(page, title);
  await panel.getByRole('switch', { name: '重复' }).uncheck();
  await expect(secondRow(page).getByRole('button', { name: '清除截止时间' })).toBeVisible();
  await waitSaved(page);
  const records = await queryRest<unknown[]>(
    request,
    `recurrence_occurrences?task_id=eq.${taskId}`,
  );
  expect(records).toHaveLength(4);
  expect(await savedRule(request, taskId)).toEqual({
    recurrence_rule: null,
    recurrence_start_on: null,
  });
  await expectDate(secondRow(page), '2026-10-06');
});

test('循环任务：这一天过完才算过去——当天晚上还是"今天"，过了午夜换成下一次，上一次记为未完成', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-05T23:50:00+08:00'));
  const id = runId();
  const title = `${id} 睡前吃药`;
  await page.goto('/');
  await quickAdd(page, title, { deadline: '2026-10-05' });
  await openTask(page, title);
  const panel = editPanel(page);
  await panel.getByRole('switch', { name: '重复' }).check();
  await period(page, '日').click();
  await pickImportance(panel, 2);
  await waitSaved(page);
  await collapse(page);

  const row = taskItem(page, title);
  await expect(row.locator('.task-deadline')).toHaveText('本次 今天');
  await switchMode(page, 'matrix');
  await matrixAllPersonal(page);
  const dot = page.locator(`.matrix-node[aria-label^="${title}，"]`);
  await expect(dot).toHaveAttribute('data-column', '5');

  // 00:05：10/5 过完了 → 代表换成 10/6（今天）；10/5 进入历史，记为未完成
  await page.clock.setFixedTime(new Date('2026-10-06T00:05:00+08:00'));
  await page.reload();
  await expect(dot).toHaveAttribute('data-column', '5');
  await switchMode(page, 'list');
  await selectStatus(page, '未完成');
  await expect(row.locator('.task-deadline')).toHaveText('本次 今天');
  await openTask(page, title);
  await expectDate(secondRow(page), '2026-10-06');
  await expect(historyRows(page)).toHaveText(['10月5日 周一']);
  await expect(history(page).getByRole('checkbox')).not.toBeChecked();
});

test('重复规则：日 / 周 / 月（日、周）/ 年（月日、月周、年周）；存成 RRULE；简介行一句话；第二行是第一次的日期；不合法不能保存', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.clock.setFixedTime(MONDAY_1554);
  const id = runId();
  const title = `${id} 规则编辑`;
  await page.goto('/');
  await quickAdd(page, title);
  const taskId = await openTask(page, title);
  const panel = editPanel(page);

  // 打开：不选模式；选了"周"以后星期全部空着，间隔是 1；不提示错误
  await panel.getByRole('switch', { name: '重复' }).check();
  await expectDate(secondRow(page), '');
  await period(page, '周').click();
  await expect(rule(page).getByLabel('重复间隔')).toHaveValue('1');
  const weekdays = rule(page).getByRole('group', { name: '星期' });
  await expect(weekdays.getByRole('button')).toHaveText(['一', '二', '三', '四', '五', '六', '日']);
  for (const button of await weekdays.getByRole('button').all()) {
    await expect(button).toHaveAttribute('aria-pressed', 'false');
  }
  await expect(panel.locator('.field-error')).toHaveCount(0);

  // 每 2 周的一、三、五；没选日期：从今天开始
  await pressOnly(weekdays, ['周一', '周三', '周五']);
  await rule(page).getByLabel('重复间隔').fill('2');
  await waitSaved(page);
  expect(await savedRule(request, taskId)).toEqual({
    recurrence_rule: 'FREQ=WEEKLY;INTERVAL=2;WKST=MO;BYDAY=MO,WE,FR',
    recurrence_start_on: '2026-10-05',
  });
  await collapse(page);
  await expect(taskItem(page, title)).toContainText('↻ 每 2 周的周一、三、五');

  // 刷新后重新展开，规则能被正确读回
  await page.reload();
  await openTask(page, title);
  await expect(period(page, '周')).toHaveAttribute('aria-checked', 'true');
  await expect(rule(page).getByLabel('重复间隔')).toHaveValue('2');
  await expect(weekdays.getByRole('button', { name: '周三' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await rule(page).getByLabel('重复间隔').fill('1');

  // 月 · 日：1 到 31 外加"最后一天"，可多选；"日 / 周"和日子都不默认选
  await period(page, '月').click();
  await expect(radio(rule(page), '按月的方式', '日')).toHaveAttribute('aria-checked', 'false');
  await expect(radio(rule(page), '按月的方式', '周')).toHaveAttribute('aria-checked', 'false');
  await radio(rule(page), '按月的方式', '日').click();
  const days = rule(page).getByRole('group', { name: '日子' });
  await expect(days.getByRole('button')).toHaveCount(32);
  await expect(days.getByRole('button').last()).toHaveText('最后一天');
  await expect(days.locator('[aria-pressed="true"]')).toHaveCount(0);
  await pressOnly(days, ['1日', '15日']);
  await waitSaved(page);
  expect((await savedRule(request, taskId)).recurrence_rule).toBe('FREQ=MONTHLY;BYMONTHDAY=1,15');
  await expectDate(secondRow(page), '2026-10-15');
  await collapse(page);
  await expect(taskItem(page, title)).toContainText('↻ 每月 1、15 日');
  await openTask(page, title);

  // 31 日和"最后一天"：10 月的 31 日就是最后一天，只算一次
  await pressOnly(rule(page).getByRole('group', { name: '日子' }), ['31日', '最后一天']);
  await waitSaved(page);
  await expectDate(secondRow(page), '2026-10-31');

  // 月 · 周：一行一个条件"第［ ］个：一 … 日"，点"＋"再加一行
  await radio(rule(page), '按月的方式', '周').click();
  const row1 = rule(page).getByRole('group', { name: '第 1 行条件' });
  // "第［ ］个"和星期都空着
  await expect(row1.getByLabel('第几个')).toHaveValue('');
  await expect(row1.locator('[aria-pressed="true"]')).toHaveCount(0);
  await expect(row1.getByLabel('第几个').locator('option')).toHaveText([
    '',
    '第 1 个',
    '第 2 个',
    '第 3 个',
    '第 4 个',
    '最后一个',
  ]);
  await row1.getByLabel('第几个').selectOption('2');
  await pressOnly(row1.getByRole('group', { name: '星期' }), ['周二']);
  await rule(page).getByRole('button', { name: '加一行条件' }).click();
  const row2 = rule(page).getByRole('group', { name: '第 2 行条件' });
  await row2.getByLabel('第几个').selectOption('4');
  await pressOnly(row2.getByRole('group', { name: '星期' }), ['周二']);
  await waitSaved(page);
  expect((await savedRule(request, taskId)).recurrence_rule).toBe('FREQ=MONTHLY;BYDAY=2TU,4TU');
  await expectDate(secondRow(page), '2026-10-13');
  await collapse(page);
  await expect(taskItem(page, title)).toContainText('↻ 每月第 2、4 个周二');
  await openTask(page, title);

  // 年 · 月日：12 个月同时展开，每个月只排 1 到 31，不按星期对齐
  await period(page, '年').click();
  await expect(radio(rule(page), '按年的方式', '月日')).toHaveAttribute('aria-checked', 'false');
  await radio(rule(page), '按年的方式', '月日').click();
  const months = rule(page).locator('.year-month');
  await expect(rule(page).locator('.year-days [aria-pressed="true"]')).toHaveCount(0);
  await expect(months).toHaveCount(12);
  for (const month of ['1月', '2月', '12月']) {
    await expect(
      rule(page).getByRole('group', { name: month, exact: true }).getByRole('button'),
    ).toHaveCount(31);
  }
  await pressOnly(rule(page).locator('.year-days'), ['1月15日', '4月15日', '7月15日', '10月15日']);
  await waitSaved(page);
  expect((await savedRule(request, taskId)).recurrence_rule).toBe(
    'FREQ=YEARLY;BYMONTH=1,4,7,10;BYMONTHDAY=15',
  );
  await expectDate(secondRow(page), '2026-10-15');
  await collapse(page);
  await expect(taskItem(page, title)).toContainText('↻ 每年 1、4、7、10 月 15 日');
  await openTask(page, title);

  // 年 · 月周："［ ］月 第［ ］个：一 … 日"
  await radio(rule(page), '按年的方式', '月周').click();
  const ym = rule(page).getByRole('group', { name: '第 1 行条件' });
  await expect(ym.getByLabel('月份')).toHaveValue('');
  await expect(ym.getByLabel('第几个')).toHaveValue('');
  await ym.getByLabel('月份').selectOption('3');
  await ym.getByLabel('第几个').selectOption('2');
  await pressOnly(ym.getByRole('group', { name: '星期' }), ['周一']);
  await waitSaved(page);
  expect((await savedRule(request, taskId)).recurrence_rule).toBe(
    'FREQ=YEARLY;BYMONTH=3;BYDAY=2MO',
  );
  await expectDate(secondRow(page), '2027-03-08');

  // 年 · 年周："第［ ］周：一 … 日"，按 ISO 8601 周数
  await radio(rule(page), '按年的方式', '年周').click();
  const yw = rule(page).getByRole('group', { name: '第 1 行条件' });
  await expect(yw.getByLabel('第几周')).toHaveValue('');
  // 没有"第 53 周"，最后一项是"最后一周"
  const weekOptions = yw.getByLabel('第几周').locator('option');
  await expect(weekOptions).toHaveCount(54);
  await expect(weekOptions.nth(52)).toHaveText('第 52 周');
  await expect(weekOptions.last()).toHaveText('最后一周');
  await yw.getByLabel('第几周').selectOption('42');
  await pressOnly(yw.getByRole('group', { name: '星期' }), ['周一']);
  await waitSaved(page);
  expect((await savedRule(request, taskId)).recurrence_rule).toBe(
    'FREQ=YEARLY;WKST=MO;BYWEEKNO=42;BYDAY=MO',
  );
  // 2026 年第 42 周的周一是 10 月 12 日
  await expectDate(secondRow(page), '2026-10-12');
  await collapse(page);
  await expect(taskItem(page, title)).toContainText('↻ 每年第 42 周周一');

  // 最后一周：2026 年有 53 周，最后一周的周一是 12 月 28 日
  await openTask(page, title);
  await rule(page)
    .getByRole('group', { name: '第 1 行条件' })
    .getByLabel('第几周')
    .selectOption({ label: '最后一周' });
  await waitSaved(page);
  expect((await savedRule(request, taskId)).recurrence_rule).toBe(
    'FREQ=YEARLY;WKST=MO;BYWEEKNO=-1;BYDAY=MO',
  );
  await expectDate(secondRow(page), '2026-12-28');
  await collapse(page);
  await expect(taskItem(page, title)).toContainText('↻ 每年最后一周周一');

  // 每 N 日
  await openTask(page, title);
  await period(page, '日').click();
  await rule(page).getByLabel('重复间隔').fill('3');
  await waitSaved(page);
  expect((await savedRule(request, taskId)).recurrence_rule).toBe('FREQ=DAILY;INTERVAL=3');
  await collapse(page);
  await expect(taskItem(page, title)).toContainText('↻ 每 3 天');
  // 开始日期一直是打开开关那天
  expect((await savedRule(request, taskId)).recurrence_start_on).toBe('2026-10-05');
});

test('循环任务建好后第二行只显示当前这一次，不能点；关掉再打开 = 重新设，从新的日期开始', async ({
  page,
  request,
}) => {
  await page.clock.setFixedTime(MONDAY_1554);
  const id = runId();
  const title = `${id} 每周一例会`;
  await page.goto('/');
  await selectStatus(page, '全部');
  await quickAdd(page, title, { deadline: '2026-09-28' });
  const taskId = await openTask(page, title);
  await editPanel(page).getByRole('switch', { name: '重复' }).check();
  await period(page, '周').click();
  await pressOnly(rule(page).getByRole('group', { name: '星期' }), ['周一']);
  await waitSaved(page);
  await expect(historyRows(page)).toHaveText(['9月28日 周一']);

  // 第二行：当前这一次（10/5），不能点
  await expectDate(secondRow(page), '2026-10-05');
  await expect(dateButton(secondRow(page))).toHaveAttribute('aria-disabled', 'true');
  await dateButton(secondRow(page)).click({ force: true });
  await expect(page.getByRole('dialog', { name: '选择时间' })).toHaveCount(0);
  // 只改规则：第二行仍然不能点，开始日期不变
  await pressOnly(rule(page).getByRole('group', { name: '星期' }), ['周一', '周三']);
  await expect(dateButton(secondRow(page))).toHaveAttribute('aria-disabled', 'true');
  await waitSaved(page);
  expect(await savedRule(request, taskId)).toEqual({
    recurrence_rule: 'FREQ=WEEKLY;WKST=MO;BYDAY=MO,WE',
    recurrence_start_on: '2026-09-28',
  });

  // 关掉再打开：重新设。什么都不选，第二行可以点
  const toggle = editPanel(page).getByRole('switch', { name: '重复' });
  await toggle.uncheck();
  await toggle.check();
  await expect(period(page, '周')).toHaveAttribute('aria-checked', 'false');
  await expect(dateButton(secondRow(page))).not.toHaveAttribute('aria-disabled', 'true');
  await pickDate(secondRow(page), '2026-10-14');
  await period(page, '周').click();
  await pressOnly(rule(page).getByRole('group', { name: '星期' }), ['周五']);
  await waitSaved(page);
  expect(await savedRule(request, taskId)).toEqual({
    recurrence_rule: 'FREQ=WEEKLY;WKST=MO;BYDAY=FR',
    recurrence_start_on: '2026-10-14',
  });
  // 第一次是 10/14 起的第一个周五；过去的历史保留（改成周一、三时补上了 9/30）
  await expectDate(secondRow(page), '2026-10-16');
  await expect(historyRows(page)).toHaveText(['9月30日 周三', '9月28日 周一']);
  await collapse(page);
  await expect(taskItem(page, title).locator('.task-deadline')).toHaveText(
    '本次 10月16日 周五 · 还剩11天',
  );
});

test('关掉循环：当前这一次变成普通任务（日期、子任务勾选保留），以后没完成也没勾过的消失，其余的都是历史', async ({
  page,
  request,
}) => {
  // 子任务按数据库的时间记下加入的时刻，这里不固定浏览器时钟，用今天前后的日子
  const id = runId();
  const title = `${id} 每天跑步`;
  const [d3, d2, d1, today, d1after, d2after] = [-3, -2, -1, 0, 1, 2].map((n) => localDate(n)) as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  await page.goto('/');
  await selectStatus(page, '全部');
  await quickAdd(page, title, { deadline: d3 });
  const taskId = await openTask(page, title);
  // 还是普通任务时就有子任务，并且勾了"拉伸"：改成循环之前的勾选，关掉循环后算历史
  const [warm, stretch] = await rpcAsMain<{ id: string; title: string }[]>(
    request,
    'set_task_subtasks',
    { p_task_id: taskId, p_items: [{ title: '热身' }, { title: '拉伸' }] },
  );
  await rpcAsMain(request, 'set_subtask_checked', {
    p_subtask_id: stretch!.id,
    p_occurrence_date: null,
    p_checked: true,
  });
  await page.reload();
  await openTask(page, title);
  await editPanel(page).getByRole('switch', { name: '重复' }).check();
  await period(page, '日').click();
  await waitSaved(page);
  // 今天这一次勾了"热身"；明天那一次勾了"热身"（没完成）；后天那一次勾了"拉伸"、并且提前完成
  for (const [subtask, date] of [
    [warm!, today],
    [warm!, d1after],
    [stretch!, d2after],
  ] as const) {
    await rpcAsMain(request, 'set_subtask_checked', {
      p_subtask_id: subtask.id,
      p_occurrence_date: date,
      p_checked: true,
    });
  }
  await insertOccurrence(request, taskId, d2after);
  await page.reload();
  await openTask(page, title);
  await history(page).getByRole('button', { name: '展开历史' }).click();
  await history(page)
    .getByRole('checkbox', { name: `完成：${dayLabel(d2)}` })
    .click();
  await expect
    .poll(async () => (await recordsOf(request, taskId)).map((r) => r.status))
    .toEqual(['missed', 'completed', 'missed', 'completed']);

  // 关掉：第二行是当前这一次（今天），可以点；以后提前完成的那一次也在历史里
  await editPanel(page).getByRole('switch', { name: '重复' }).uncheck();
  await expectDate(secondRow(page), today);
  await expect(dateButton(secondRow(page))).not.toHaveAttribute('aria-disabled', 'true');
  await expect(historyRows(page)).toHaveCount(4);
  await waitSaved(page);

  // 1) 当前这一次变成普通任务：日期、子任务勾选保留
  const [task] = await queryRest<Record<string, unknown>[]>(
    request,
    `tasks?id=eq.${taskId}&select=recurrence_rule,recurrence_start_on,deadline_on,completed_at`,
  );
  expect(task).toEqual({
    recurrence_rule: null,
    recurrence_start_on: null,
    deadline_on: today,
    completed_at: null,
  });
  // 勾选一条都不删：今天这一次的变成普通任务的；改成循环之前的成为历史（不再算现在的）；其余各次的照旧
  const checks = await queryRest<
    { subtask_id: string; occurrence_date: string | null; archived_at: string | null }[]
  >(
    request,
    `task_subtask_checks?subtask_id=in.(${warm!.id},${stretch!.id})&select=subtask_id,occurrence_date,archived_at`,
  );
  const key = (subtaskId: string, date: string | null, archived = false) =>
    `${subtaskId}:${date ?? ''}:${archived ? 'archived' : ''}`;
  // （补登记 d2 完成时一起勾上哪些子任务取决于子任务加入的时刻，这里不看）
  expect(
    checks
      .filter((c) => c.occurrence_date !== d2)
      .map((c) => key(c.subtask_id, c.occurrence_date, c.archived_at !== null))
      .sort(),
  ).toEqual(
    [
      key(stretch!.id, null, true),
      key(warm!.id, null),
      key(warm!.id, d1after),
      // 后天那一次提前完成时，没勾的子任务一起勾上
      key(warm!.id, d2after),
      key(stretch!.id, d2after),
    ].sort(),
  );
  await collapse(page);
  const row = taskItem(page, title);
  await expect(row.locator('.task-deadline')).toHaveText('今天');
  await expect(row.locator('.subtask-toggle')).toHaveText('1/2');
  await expect(row).not.toContainText('↻');

  // 2) 以后没完成、也没勾过子任务的消失；勾过的留在历史里，显示为没完成；提前完成的保留
  // 3) 过去的历史保留
  expect((await recordsOf(request, taskId)).map((r) => [r.occurrence_date, r.status])).toEqual([
    [d3, 'missed'],
    [d2, 'completed'],
    [d1, 'missed'],
    [d1after, 'missed'],
    [d2after, 'completed'],
  ]);
  // 历史在这个任务里仍然能看到、能修改；不再增加
  await page.clock.setFixedTime(new Date(Date.now() + 4 * 86_400_000));
  await page.reload();
  await openTask(page, title);
  await expect(editPanel(page).getByRole('switch', { name: '重复' })).not.toBeChecked();
  await history(page).getByRole('button', { name: '展开历史' }).click();
  await expect(historyRows(page)).toHaveCount(5);
  for (const [i, date] of [d2after, d1after, d1, d2, d3].entries()) {
    await expect(historyRows(page).nth(i)).toContainText(dayLabel(date));
  }
  // 勾过子任务的那一次：没完成，显示它的进度
  const d1afterRow = historyRows(page).nth(1);
  await expect(d1afterRow).toHaveClass(/task-missed/);
  await expect(d1afterRow.locator('.history-progress')).toHaveText('1/2');
  await history(page)
    .getByRole('checkbox', { name: `完成：${dayLabel(d3)}` })
    .click();
  await expect
    .poll(async () => (await recordsOf(request, taskId)).map((r) => r.status))
    .toEqual(['completed', 'completed', 'missed', 'missed', 'completed']);
});

test('什么都没选就保存 = 没有开启循环；循环任务改成什么都不选 = 关掉循环', async ({
  page,
  request,
}) => {
  await page.clock.setFixedTime(MONDAY_1554);
  const id = runId();
  const title = `${id} 什么都没选`;
  await page.goto('/');
  await selectStatus(page, '全部');
  await quickAdd(page, title, { deadline: '2026-10-08' });
  const taskId = await openTask(page, title);
  const toggle = editPanel(page).getByRole('switch', { name: '重复' });

  // 打开开关、不选模式，保存：还是普通任务
  await toggle.check();
  await waitSaved(page);
  expect(await savedRule(request, taskId)).toEqual({
    recurrence_rule: null,
    recurrence_start_on: null,
  });
  await expect(toggle).not.toBeChecked();
  // 选了"月"、"日"但一天都没选：也一样
  await toggle.check();
  await period(page, '月').click();
  await radio(rule(page), '按月的方式', '日').click();
  await waitSaved(page);
  expect((await savedRule(request, taskId)).recurrence_rule).toBeNull();
  await expectDate(secondRow(page), '2026-10-08');

  // 做成循环任务（每天，从 10/3 起），再把规则改成什么都不选
  await patchTask(request, taskId, {
    recurrence_rule: 'FREQ=DAILY',
    recurrence_start_on: '2026-10-03',
  });
  await page.reload();
  await openTask(page, title);
  await expect(toggle).toBeChecked();
  await period(page, '周').click();
  await waitSaved(page);
  const [task] = await queryRest<Record<string, unknown>[]>(
    request,
    `tasks?id=eq.${taskId}&select=recurrence_rule,deadline_on`,
  );
  expect(task).toEqual({ recurrence_rule: null, deadline_on: '2026-10-05' });
  expect((await recordsOf(request, taskId)).map((r) => r.occurrence_date)).toEqual([
    '2026-10-03',
    '2026-10-04',
  ]);
});

test('循环任务历史：几百条记录时展开五行高、可滚动看到最早的一条', async ({ page, request }) => {
  await page.clock.setFixedTime(MONDAY_1554);
  const id = runId();
  const title = `${id} 长期打卡`;
  await page.goto('/');
  await quickAdd(page, title);
  const taskId = (
    await queryRest<{ id: string }[]>(request, `tasks?select=id&title=eq.${title}`)
  )[0]!.id;
  await patchTask(request, taskId, {
    recurrence_rule: 'FREQ=DAILY',
    recurrence_start_on: '2026-04-01',
  });
  await page.reload();
  await expect(taskItem(page, title).locator('.task-deadline')).toHaveText('本次 今天');
  const count = async () =>
    (await queryRest<unknown[]>(request, `recurrence_occurrences?task_id=eq.${taskId}`)).length;
  await expect.poll(count).toBe(187); // 4/1 … 10/4
  await openTask(page, title);
  await expect(historyRows(page)).toHaveCount(2);

  // 展开：五行高，可以上下滚动，滚到底是最早的 4 月 1 日
  await history(page).getByRole('button', { name: '展开历史' }).click();
  await expect(historyRows(page)).toHaveCount(187);
  const list = history(page).locator('.history-rows');
  const rowH = (await historyRows(page).first().boundingBox())!.height;
  expect(Math.round((await list.boundingBox())!.height / rowH)).toBe(5);
  await list.hover();
  await page.mouse.wheel(0, 100_000);
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await expect(historyRows(page).last()).toHaveText('4月1日 周三');
  await expect(historyRows(page).last()).toBeInViewport();
});

test('改循环规则：已发生的记录保持不变，之后新规则下过去的那几次继续被记录', async ({
  page,
  request,
}) => {
  const id = runId();
  const title = `${id} 改规则`;
  await page.clock.setFixedTime(MONDAY_1554);
  await page.goto('/');
  await selectStatus(page, '全部');
  await quickAdd(page, title, { deadline: '2026-10-01' });
  const taskId = await openTask(page, title);
  await editPanel(page).getByRole('switch', { name: '重复' }).check();
  await period(page, '日').click();
  await waitSaved(page);
  const records = () =>
    queryRest<{ occurrence_date: string; status: string }[]>(
      request,
      `recurrence_occurrences?task_id=eq.${taskId}&order=occurrence_date&select=occurrence_date,status`,
    );
  await expect.poll(async () => (await records()).length).toBe(4); // 10/1 … 10/4
  // 补登记 10/3 做了
  await history(page).getByRole('button', { name: '展开历史' }).click();
  await history(page).getByRole('checkbox', { name: '完成：10月3日 周六' }).click();
  await expect
    .poll(async () => (await records()).map((r) => r.status))
    .toEqual(['missed', 'missed', 'completed', 'missed']);
  const before = await records();

  // 改成每 2 天一次（开始日期不变）
  await rule(page).getByLabel('重复间隔').fill('2');
  await waitSaved(page);
  await collapse(page);
  expect(await records()).toEqual(before);

  // 10/7 打开：旧记录都在，新规则下已经过去的 10/5 继续被记录；10/7 是今天
  await page.clock.setFixedTime(new Date('2026-10-07T15:54:00+08:00'));
  await page.reload();
  await expect(taskItem(page, title)).toBeVisible();
  await expect.poll(async () => (await records()).length).toBe(5);
  const after = await records();
  expect(after.slice(0, 4)).toEqual(before);
  expect(after[4]).toEqual({ occurrence_date: '2026-10-05', status: 'missed' });
  await expect(taskItem(page, title).locator('.task-deadline')).toHaveText('本次 今天');
});

test('回归：勾选"完成本次"时，切换页面引起的重新加载晚到，也不会把代表实例退回前一天', async ({
  page,
  request,
}) => {
  await page.clock.setFixedTime(MONDAY_1554);
  const title = `${runId()} 每天喝水`;
  await page.goto('/');
  await quickAdd(page, title);
  const taskId = (
    await queryRest<{ id: string }[]>(request, `tasks?select=id&title=eq.${title}`)
  )[0]!.id;
  await patchTask(request, taskId, {
    recurrence_rule: 'FREQ=DAILY',
    recurrence_start_on: '2026-10-02',
  });
  await page.reload();
  await switchMode(page, 'matrix');
  await matrixAllPersonal(page);
  // 回到清单时的重新加载：读循环记录的那个请求晚 1.5 秒才回来（模拟慢网络），
  // 它读到的是勾选之前的数据
  let slow = true;
  await page.route('**/rest/v1/recurrence_occurrences?**', async (route) => {
    if (slow && route.request().method() === 'GET') {
      slow = false;
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });
  const started = page.waitForRequest(
    (r) => r.url().includes('recurrence_occurrences') && r.method() === 'GET',
  );
  await switchMode(page, 'list');
  await started;
  const row = taskItem(page, title);
  await page.getByRole('checkbox', { name: `完成本次：${title}` }).click();
  await expect(row.locator('.task-deadline')).toHaveText('本次 10月6日 周二 · 还剩1天');
  // 晚到的旧数据回来之后，仍然是 10/6
  await page.waitForTimeout(2000);
  await expect(row.locator('.task-deadline')).toHaveText('本次 10月6日 周二 · 还剩1天');
});

for (const timezoneId of ['America/Los_Angeles', 'Pacific/Kiritimati', 'Asia/Kolkata']) {
  test(`回归：接近午夜、跨日时循环任务的日期按用户本地日期（${timezoneId}）`, async ({
    browser,
    request,
  }) => {
    const context = await browser.newContext({
      timezoneId,
      locale: 'zh-CN',
      storageState: './e2e/.auth/state.json',
    });
    const page = await context.newPage();
    const local = (wall: string) => {
      const guess = new Date(`${wall}Z`);
      const shown = new Intl.DateTimeFormat('sv-SE', {
        timeZone: timezoneId,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      })
        .format(guess)
        .replace(' ', 'T');
      return new Date(guess.getTime() - (new Date(`${shown}Z`).getTime() - guess.getTime()));
    };
    // 本地时间 2026-10-05 23:50（周一）
    await page.clock.setFixedTime(local('2026-10-05T23:50:00'));
    const title = `${runId()} 睡前`;
    await page.goto('/');
    await quickAdd(page, title);
    const taskId = (
      await queryRest<{ id: string }[]>(request, `tasks?select=id&title=eq.${title}`)
    )[0]!.id;
    await patchTask(request, taskId, {
      recurrence_rule: 'FREQ=DAILY',
      recurrence_start_on: '2026-10-01',
    });
    await page.reload();
    const row = taskItem(page, title);
    // 今天还没过完 → 本次是今天
    await expect(row.locator('.task-deadline')).toHaveText('本次 今天');
    // 过了午夜：本次是 10/6（今天）
    await page.clock.setFixedTime(local('2026-10-06T00:05:00'));
    await page.reload();
    await expect(row.locator('.task-deadline')).toHaveText('本次 今天');
    // 完成本次：顺延到 10/7
    await page.getByRole('checkbox', { name: `完成本次：${title}` }).click();
    await expect(row.locator('.task-deadline')).toHaveText('本次 10月7日 周三 · 还剩1天');
    // 记录的是 10/6 那一次（用户本地的日期）
    const records = await queryRest<{ occurrence_date: string; status: string }[]>(
      request,
      `recurrence_occurrences?task_id=eq.${taskId}&order=occurrence_date`,
    );
    expect(records.map((r) => [r.occurrence_date, r.status])).toEqual([
      ['2026-10-01', 'missed'],
      ['2026-10-02', 'missed'],
      ['2026-10-03', 'missed'],
      ['2026-10-04', 'missed'],
      ['2026-10-05', 'missed'],
      ['2026-10-06', 'completed'],
    ]);
    await context.close();
  });
}
