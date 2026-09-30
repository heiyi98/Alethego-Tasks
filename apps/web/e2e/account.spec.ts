import { expect, test, type Page } from '@playwright/test';

import { accessTokenFor, loginViaUi, newCredentials, signUpUser, type Credentials } from './auth';
import { queryRest, quickAdd, runId, taskItem } from './helpers';

// 这些用例自己管理登录状态：从"没登录"开始
test.use({ storageState: { cookies: [], origins: [] } });

const sidebar = (page: Page) => page.getByRole('navigation', { name: '主菜单' });
const accountSection = (page: Page) => sidebar(page).getByRole('region', { name: '账号' });
const accountButton = (page: Page) => accountSection(page).locator('.account-current');
const loginForm = (page: Page) => page.getByRole('form', { name: /^(登录|注册)$/ });

async function openAccountMenu(page: Page) {
  const button = accountButton(page);
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
}

async function userRow(credentials: Credentials) {
  const request = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/users?select=id,email,display_name`,
    {
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${await accessTokenFor(credentials)}`,
        'Accept-Profile': 'taskapp',
      },
    },
  );
  return (await request.json()) as { id: string; email: string; display_name: string }[];
}

test('没登录时只显示登录页：邮箱密码（登录 / 注册）与 Google 登录两种方式', async ({ page }) => {
  await page.goto('/');
  await expect(loginForm(page)).toBeVisible();
  await expect(sidebar(page)).toHaveCount(0);
  await expect(page.getByLabel('快速添加任务')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '使用 Google 登录' })).toBeVisible();
  // 矩阵页同样只显示登录页
  await page.goto('/matrix');
  await expect(loginForm(page)).toBeVisible();
  await expect(page.locator('svg.matrix')).toHaveCount(0);

  // 密码错误
  const user = await signUpUser();
  const form = loginForm(page);
  await form.getByLabel('邮箱').fill(user.email);
  await form.getByLabel('密码').fill('wrong-password');
  await form.getByRole('button', { name: '登录' }).click();
  await expect(form.getByRole('alert')).toHaveText('邮箱或密码不正确');
  await expect(sidebar(page)).toHaveCount(0);

  // Google 登录：跳到 Alethego 的授权地址（provider=google），登录后回到 TaskApp
  let authorize: URL | null = null;
  await page.route('**/auth/v1/authorize**', async (route) => {
    authorize = new URL(route.request().url());
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'google' });
  });
  await page.getByRole('button', { name: '使用 Google 登录' }).click();
  await expect.poll(() => authorize?.searchParams.get('provider')).toBe('google');
  expect(authorize!.origin).toBe(new URL(process.env.NEXT_PUBLIC_ALETHEGO_URL!).origin);
  expect(authorize!.searchParams.get('redirect_to')).toMatch(/^http:\/\/localhost:\d+\/matrix$/);
});

test('注册：首次登录自动创建用户行，名字默认取邮箱 @ 前面那一段；Alethego 里有名字时用那个名字', async ({
  page,
  browser,
}) => {
  const credentials = newCredentials('signup');
  await page.goto('/');
  await loginViaUi(page, credentials, '注册');
  const local = credentials.email.split('@')[0]!;
  await expect(accountButton(page)).toHaveText(local);
  const [row] = await userRow(credentials);
  expect(row).toMatchObject({ email: credentials.email, display_name: local });

  // 带名字的账号（Google 登录会有）：默认名字取 Alethego 里的名字
  const named = await signUpUser(newCredentials('named'), { full_name: '王小明' });
  const context = await browser.newContext();
  const other = await context.newPage();
  await other.goto('/');
  await loginViaUi(other, named);
  await expect(accountButton(other)).toHaveText('王小明');
  expect((await userRow(named))[0]).toMatchObject({ display_name: '王小明', email: named.email });
  await context.close();
});

test('改名字：当前账号的名字点开原地编辑，保存到 taskapp.users；之后再登录不会被 Alethego 覆盖', async ({
  page,
}) => {
  const user = await signUpUser(newCredentials('rename'), { full_name: '原来的名字' });
  await page.goto('/');
  await loginViaUi(page, user);
  await openAccountMenu(page);
  const current = accountSection(page).locator('.account-row-current');
  await current.getByRole('button', { name: '原来的名字' }).click();
  const input = current.getByRole('textbox', { name: '名字' });
  await expect(input).toBeFocused();
  await input.fill('新名字');
  await input.press('Enter');
  await expect(accountButton(page)).toHaveText('新名字');
  await expect.poll(async () => (await userRow(user))[0]?.display_name).toBe('新名字');

  // Esc 放弃
  await current.getByRole('button', { name: '新名字' }).click();
  await input.fill('不要的');
  await input.press('Escape');
  await expect(accountButton(page)).toHaveText('新名字');

  // 刷新（登录时会按 Alethego 更新 email）后名字仍是 TaskApp 里改的
  await page.reload();
  await expect(accountButton(page)).toHaveText('新名字');
  expect((await userRow(user))[0]?.display_name).toBe('新名字');
});

test('两个账号的数据互相隔离；添加账号后在两个账号之间切换，不需要再输密码', async ({ page }) => {
  const id = runId();
  const a = await signUpUser(newCredentials('a'), { full_name: `${id}甲` });
  const b = await signUpUser(newCredentials('b'), { full_name: `${id}乙` });

  await page.goto('/');
  await loginViaUi(page, a);
  await quickAdd(page, `${id} 甲的任务`);

  // 添加账号：进入登录页（可取消），登录后加入列表并切换过去
  await openAccountMenu(page);
  await accountSection(page).getByRole('button', { name: '添加账号' }).click();
  await expect(loginForm(page)).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();
  await expect(accountButton(page)).toHaveText(`${id}甲`);
  await openAccountMenu(page);
  await accountSection(page).getByRole('button', { name: '添加账号' }).click();
  await loginViaUi(page, b);
  await expect(accountButton(page)).toHaveText(`${id}乙`);

  // 乙看不到甲的任务，数据库里也查不到
  await expect(page.getByLabel('快速添加任务')).toBeVisible();
  await expect(taskItem(page, `${id} 甲的任务`)).toHaveCount(0);
  await quickAdd(page, `${id} 乙的任务`);
  const bTasks = await queryRest<{ title: string }[]>(page.request, 'tasks?select=title', b);
  expect(bTasks.map((t) => t.title)).toEqual([`${id} 乙的任务`]);
  const aTasks = await queryRest<{ title: string }[]>(page.request, 'tasks?select=title', a);
  expect(aTasks.map((t) => t.title)).toEqual([`${id} 甲的任务`]);
  // 没登录（只带 apikey）什么都查不到
  const anon = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/tasks?select=id`, {
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
      'Accept-Profile': 'taskapp',
    },
  });
  expect(await anon.json()).toEqual([]);

  // 账号菜单列出这台设备上的两个账号；点甲直接切换，不需要密码
  await openAccountMenu(page);
  await expect(accountSection(page).locator('.account-row')).toHaveCount(2);
  await accountSection(page)
    .getByRole('button', { name: `切换到「${id}甲」` })
    .click();
  await expect(accountButton(page)).toHaveText(`${id}甲`);
  await expect(taskItem(page, `${id} 甲的任务`)).toBeVisible();
  await expect(taskItem(page, `${id} 乙的任务`)).toHaveCount(0);

  // 刷新后仍是甲；再切回乙
  await page.reload();
  await expect(accountButton(page)).toHaveText(`${id}甲`);
  await openAccountMenu(page);
  await accountSection(page)
    .getByRole('button', { name: `切换到「${id}乙」` })
    .click();
  await expect(taskItem(page, `${id} 乙的任务`)).toBeVisible();
});

test('退出：退出这台设备上的所有账号，回到登录页；刷新后仍需登录', async ({ page }) => {
  const a = await signUpUser(newCredentials('out-a'));
  const b = await signUpUser(newCredentials('out-b'));
  await page.goto('/');
  await loginViaUi(page, a);
  await openAccountMenu(page);
  await accountSection(page).getByRole('button', { name: '添加账号' }).click();
  await loginViaUi(page, b);

  await openAccountMenu(page);
  await accountSection(page).getByRole('button', { name: '退出' }).click();
  await expect(loginForm(page)).toBeVisible();
  await expect(sidebar(page)).toHaveCount(0);
  await page.reload();
  await expect(loginForm(page)).toBeVisible();

  // 这台设备上不再留有任何账号或会话
  const keys = await page.evaluate(() => Object.keys(window.localStorage));
  expect(keys.filter((k) => k.startsWith('alethego-tasks.auth.'))).toEqual([]);
  expect(await page.evaluate(() => window.localStorage.getItem('alethego-tasks.accounts'))).toBe(
    JSON.stringify({ activeId: null, accounts: [] }),
  );

  // 再登录甲：账号列表里只有甲
  await loginViaUi(page, a);
  await openAccountMenu(page);
  await expect(accountSection(page).locator('.account-row')).toHaveCount(1);
});

test('会话到期自动续期：不需要重新登录', async ({ page }) => {
  const user = await signUpUser(newCredentials('refresh'));
  await page.goto('/');
  await loginViaUi(page, user);
  await quickAdd(page, '续期之前');

  // 把本机保存的会话改成"已经过期"
  const key = await page.evaluate(() =>
    Object.keys(window.localStorage).find(
      (k) => k.startsWith('alethego-tasks.auth.') && !k.endsWith('pending'),
    ),
  );
  const before = await page.evaluate((k) => {
    const session = JSON.parse(window.localStorage.getItem(k!)!);
    session.expires_at = Math.floor(Date.now() / 1000) - 60;
    window.localStorage.setItem(k!, JSON.stringify(session));
    return session as { refresh_token: string; expires_at: number };
  }, key);

  await page.reload();
  // 没有回到登录页，数据照常可读写
  await expect(sidebar(page)).toBeVisible();
  await expect(taskItem(page, '续期之前')).toBeVisible();
  await quickAdd(page, '续期之后');
  // 用续期凭证换了一份新的会话：续期凭证轮换，到期时间回到未来
  const after = await page.evaluate(
    (k) =>
      JSON.parse(window.localStorage.getItem(k!)!) as { refresh_token: string; expires_at: number },
    key,
  );
  expect(after.refresh_token).not.toBe(before.refresh_token);
  expect(after.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
});
