import { expect, test } from '@playwright/test';

import { loginViaUi, newCredentials } from './auth';
import { quickAdd, runId, taskItem } from './helpers';

/**
 * 中国大陆配置（NEXT_PUBLIC_REGION=china）：只在 china 这个 Playwright 项目里跑，
 * 连的是另外构建的一份前端（见 playwright.config.ts）。本地测试时这份前端的登录地址和数据地址
 * 指向同一个 Supabase 实例（同一个网关地址，用它自己的 Auth），顺带验证这种部署方式。
 */
test.use({ storageState: { cookies: [], origins: [] } });

test('中国大陆配置：登录页没有 Google 登录；邮箱注册、登录后能正常读写数据', async ({ page }) => {
  const hosts = new Set<string>();
  page.on('request', (request) => hosts.add(new URL(request.url()).host));

  await page.goto('/');
  await expect(page.getByRole('form', { name: '登录' })).toBeVisible();
  await expect(page.getByRole('button', { name: '使用 Google 登录' })).toHaveCount(0);
  await expect(page.getByText('Google')).toHaveCount(0);

  const credentials = newCredentials('china');
  await loginViaUi(page, credentials, '注册');

  const title = `${runId()} 大陆`;
  await quickAdd(page, title);
  await expect(taskItem(page, title)).toBeVisible();
  await page.reload();
  await expect(taskItem(page, title)).toBeVisible();

  // 浏览器只请求这个应用自己和配置的 Supabase 地址，没有任何外部服务
  const allowed = new Set([
    new URL(page.url()).host,
    new URL(process.env.E2E_CHINA_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!).host,
    new URL(process.env.E2E_CHINA_SUPABASE_URL ?? process.env.NEXT_PUBLIC_ALETHEGO_URL!).host,
  ]);
  expect([...hosts].filter((h) => !allowed.has(h))).toEqual([]);
});
