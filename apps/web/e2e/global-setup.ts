import { mkdirSync, writeFileSync } from 'node:fs';

import { chromium, type FullConfig } from '@playwright/test';

import { AUTH_DIR, MAIN_STATE_FILE, MAIN_USER_FILE, loginViaUi, signUpUser } from './auth';

/**
 * 每次运行先在本地 Alethego 注册一个新的主测试账号，经登录页登录一次，保存登录状态；
 * 之后的用例默认都以这个账号登录（各用例再用随机前缀隔离自己的数据）。
 */
export default async function globalSetup(config: FullConfig) {
  mkdirSync(AUTH_DIR, { recursive: true });
  const user = await signUpUser();
  writeFileSync(MAIN_USER_FILE, JSON.stringify(user));

  const { baseURL, timezoneId, locale } = config.projects[0]!.use;
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL, timezoneId, locale });
  await page.goto('/');
  await loginViaUi(page, user);
  await page.context().storageState({ path: MAIN_STATE_FILE });
  await browser.close();
}
