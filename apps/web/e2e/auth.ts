import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, type Page } from '@playwright/test';

/**
 * 端到端测试里的账号：连本地模拟的 Alethego（真实的 Supabase Auth，邮箱自动确认），
 * 不连真实的 Alethego / Mindo 项目。
 */

export interface Credentials {
  email: string;
  password: string;
}

/** 全局准备（global-setup.ts）注册的主测试账号与它的登录状态 */
export const AUTH_DIR = fileURLToPath(new URL('./.auth/', import.meta.url));
export const MAIN_USER_FILE = `${AUTH_DIR}user.json`;
export const MAIN_STATE_FILE = `${AUTH_DIR}state.json`;

const alethegoUrl = () => process.env.NEXT_PUBLIC_ALETHEGO_URL!;
const alethegoKey = () => process.env.NEXT_PUBLIC_ALETHEGO_PUBLISHABLE_KEY!;

export function mainUser(): Credentials {
  return JSON.parse(readFileSync(MAIN_USER_FILE, 'utf8')) as Credentials;
}

export function newCredentials(tag = 'user'): Credentials {
  return {
    email: `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    password: 'e2e-password-123',
  };
}

async function authFetch(path: string, body: object) {
  const response = await fetch(`${alethegoUrl()}/auth/v1${path}`, {
    method: 'POST',
    headers: { apikey: alethegoKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(json)}`);
  return json;
}

/** 直接在 Alethego 注册一个账号（不经过界面）；metadata 模拟 Google 登录带来的名字 */
export async function signUpUser(
  credentials: Credentials = newCredentials(),
  metadata: Record<string, string> = {},
): Promise<Credentials> {
  await authFetch('/signup', { ...credentials, data: metadata });
  return credentials;
}

const tokens = new Map<string, string>();

/** 某个账号的 access token（用于测试里直接查数据库，按 RLS 只看得到这个账号的数据） */
export async function accessTokenFor(credentials: Credentials = mainUser()): Promise<string> {
  let token = tokens.get(credentials.email);
  if (!token) {
    const json = await authFetch('/token?grant_type=password', credentials);
    token = json.access_token as string;
    tokens.set(credentials.email, token);
  }
  return token;
}

/** 在登录页用邮箱密码登录（或注册） */
export async function loginViaUi(
  page: Page,
  credentials: Credentials,
  mode: '登录' | '注册' = '登录',
) {
  await page.getByRole('group', { name: '登录或注册' }).getByRole('button', { name: mode }).click();
  const form = page.getByRole('form', { name: mode });
  await form.getByLabel('邮箱').fill(credentials.email);
  await form.getByLabel('密码').fill(credentials.password);
  await form.getByRole('button', { name: mode }).click();
  await expect(page.getByRole('navigation', { name: '主菜单' })).toBeVisible();
}
