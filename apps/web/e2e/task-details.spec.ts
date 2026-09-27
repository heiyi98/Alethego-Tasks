import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { openTask, quickAdd, runId } from './helpers';

async function queryRest<T>(request: APIRequestContext, path: string): Promise<T> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const response = await request.get(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Accept-Profile': 'taskapp' },
  });
  return (await response.json()) as T;
}

async function save(page: Page) {
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('status')).toHaveText('已保存');
}

test('详情页：地点（一个）与人物（多个）的添加、修改、删除', async ({ page, request }) => {
  const id = runId();
  const title = `${id} 签合同`;
  await page.goto('/');
  await quickAdd(page, title);
  await openTask(page, title);
  const taskId = page.url().split('/tasks/')[1]!;

  await page.getByLabel('地点名称').fill('客户公司');
  await page.getByLabel('地址').fill('人民路 1 号');
  await page.getByRole('button', { name: '+ 添加人物' }).click();
  await page.getByLabel('第 1 个人物的姓名').fill('张三');
  await page.getByLabel('第 1 个人物的关系').fill('客户');
  await page.getByRole('button', { name: '+ 添加人物' }).click();
  await page.getByLabel('第 2 个人物的姓名').fill('李四');
  await page.getByRole('button', { name: '+ 添加人物' }).click(); // 空行保存时被忽略
  await save(page);

  // 刷新后读回
  await page.reload();
  await expect(page.getByLabel('地点名称')).toHaveValue('客户公司');
  await expect(page.getByLabel('地址')).toHaveValue('人民路 1 号');
  await expect(page.getByLabel('第 1 个人物的姓名')).toHaveValue('张三');
  await expect(page.getByLabel('第 1 个人物的关系')).toHaveValue('客户');
  await expect(page.getByLabel('第 2 个人物的姓名')).toHaveValue('李四');
  await expect(page.getByLabel('第 3 个人物的姓名')).toHaveCount(0);

  const [location] = await queryRest<Record<string, unknown>[]>(
    request,
    `task_locations?task_id=eq.${taskId}`,
  );
  expect(location).toMatchObject({ name: '客户公司', place_id: null, lat: null, lng: null });
  const people = await queryRest<{ id: string; name: string; contact_id: null }[]>(
    request,
    `task_people?task_id=eq.${taskId}&order=created_at`,
  );
  expect(people.map((p) => p.name)).toEqual(['张三', '李四']);
  const zhangId = people[0]!.id;

  // 只填关系不填姓名 → 不能保存
  await page.getByRole('button', { name: '+ 添加人物' }).click();
  await page.getByLabel('第 3 个人物的关系').fill('同事');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('status')).toHaveText('第 3 个人物缺少姓名');
  await page.getByRole('button', { name: '删除第 3 个人物' }).click();

  // 修改张三、删除李四、清空地点
  await page.getByLabel('第 1 个人物的关系').fill('甲方');
  await page.getByRole('button', { name: '删除第 2 个人物' }).click();
  await page.getByLabel('地点名称').fill('');
  await page.getByLabel('地址').fill('');
  await save(page);

  await page.reload();
  await expect(page.getByLabel('第 1 个人物的关系')).toHaveValue('甲方');
  await expect(page.getByLabel('第 2 个人物的姓名')).toHaveCount(0);
  await expect(page.getByLabel('地点名称')).toHaveValue('');

  const after = await queryRest<{ id: string; relation: string }[]>(
    request,
    `task_people?task_id=eq.${taskId}`,
  );
  expect(after).toEqual([expect.objectContaining({ id: zhangId, relation: '甲方' })]);
  expect(await queryRest<unknown[]>(request, `task_locations?task_id=eq.${taskId}`)).toEqual([]);
});
