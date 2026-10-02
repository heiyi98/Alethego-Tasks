import { expect, type Browser, type Page } from '@playwright/test';

import { accessTokenFor, loginViaUi, newCredentials, signUpUser, type Credentials } from './auth';

/** 合作组 / 管理组用例共用：多个账号、名单窗口、侧边栏的组、通知 */

export type GroupUser = Credentials & { name: string };

export const sidebar = (page: Page) => page.getByRole('navigation', { name: '主菜单' });
export const groupSection = (page: Page) => sidebar(page).getByRole('region', { name: '组' });
export const groupLink = (page: Page, name: string) =>
  groupSection(page).getByRole('link', { name, exact: false });
export const bell = (page: Page) => sidebar(page).getByRole('button', { name: '通知' });
export const notificationList = (page: Page) =>
  sidebar(page).getByRole('dialog', { name: '通知列表' });
export const titleBar = (page: Page) => page.locator('h1.title-bar');
export const rosterDialog = (page: Page) => page.getByRole('dialog', { name: '名单' });
export const confirmDialog = (page: Page) => page.getByRole('alertdialog');

export async function user(tag: string, name: string): Promise<GroupUser> {
  const credentials = await signUpUser(newCredentials(tag), { full_name: name });
  return { ...credentials, name };
}

/** 一个账号一个浏览器上下文，经登录页登录（第一次登录也会自动建好 TaskApp 的用户行） */
export async function openAs(browser: Browser, credentials: Credentials): Promise<Page> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto('/');
  await loginViaUi(page, credentials);
  return page;
}

/** 直接调数据库函数（准备数据用；按这个账号的身份） */
export async function rpc<T>(credentials: Credentials, fn: string, args: object = {}): Promise<T> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${await accessTokenFor(credentials)}`,
      'Content-Profile': 'taskapp',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${fn}: ${response.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

/** 按这个账号的身份直接查表（RLS 决定看得到什么） */
export async function select<T>(credentials: Credentials, path: string): Promise<T[]> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${await accessTokenFor(credentials)}`,
      'Accept-Profile': 'taskapp',
    },
  });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return (await response.json()) as T[];
}

/** 当前账号的编号（令牌里的 sub） */
export async function userId(credentials: Credentials): Promise<string> {
  const token = await accessTokenFor(credentials);
  return JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()).sub as string;
}

/** 准备：甲建组，其余的人直接入组（接受邀请） */
export async function groupWith(
  owner: GroupUser,
  members: GroupUser[],
  name: string,
  kind: 'cooperative' | 'management' = 'cooperative',
): Promise<string> {
  for (const u of [owner, ...members]) {
    await rpc(u, 'ensure_current_user', { p_email: u.email, p_display_name: u.name });
  }
  const group = await rpc<{ id: string }>(owner, 'create_group_v2', {
    p_name: name,
    p_kind: kind,
    p_color: null,
  });
  for (const member of members) {
    await rpc(owner, 'invite_to_group', { p_group_id: group.id, p_email: member.email });
    // 被邀请人自己看得到发给他的邀请
    const [invitation] = await select<{ id: string }>(
      member,
      `group_invitations?select=id&group_id=eq.${group.id}`,
    );
    await rpc(member, 'accept_group_invitation', { p_invitation_id: invitation!.id });
  }
  return group.id;
}

/** 打开名单窗口（标题行组名右边的按钮） */
export async function openRoster(page: Page) {
  await page.locator('.title-row').getByRole('button', { name: '名单' }).click();
  await expect(rosterDialog(page)).toBeVisible();
  return rosterDialog(page);
}

/** 名单窗口里某个人的一行 */
export const rosterRow = (page: Page, name: string) =>
  rosterDialog(page)
    .locator('.roster-row')
    .filter({ has: page.locator('.roster-name', { hasText: new RegExp(`^${name}$`) }) });

/** 名单窗口里对某个人的操作（先点 ⋯） */
export async function rosterAction(page: Page, name: string, action: string) {
  const row = rosterRow(page, name);
  await row.getByRole('button', { name: `「${name}」的操作` }).click();
  await row.getByRole('button', { name: action, exact: true }).click();
}

/** 侧边栏里组旁边的铅笔：打开编辑组的原地表单 */
export async function editGroup(page: Page, name: string) {
  await groupSection(page)
    .getByRole('button', { name: `编辑组「${name}」` })
    .click();
  const form = groupSection(page).getByRole('form', { name: `编辑组「${name}」` });
  await expect(form.getByLabel('我在本组的昵称')).toBeEnabled();
  return form;
}

/** 准备：在组里建一条任务（按这个账号的身份），可同时设定 RACI；返回任务 id */
export async function groupTask(
  creator: Credentials,
  groupId: string,
  title: string,
  raci: { role: 'R' | 'A' | 'C' | 'I'; userId?: string; contactId?: string }[] = [],
  fields: Record<string, unknown> = {},
): Promise<string> {
  // 管理组：任务和 RACI 必须一起写入（至少一个执行人和一个负责人）
  if (raci.length > 0) {
    const task = await rpc<{ id: string }>(creator, 'create_task_with_raci', {
      p_group_id: groupId,
      p_title: title,
      p_description: (fields.description as string | undefined) ?? '',
      p_deadline_at: (fields.deadline_at as string | undefined) ?? null,
      p_recurrence_rule: null,
      p_recurrence_dtstart: null,
      p_assignments: raci.map((a) =>
        a.userId ? { role: a.role, user_id: a.userId } : { role: a.role, contact_id: a.contactId },
      ),
    });
    return task.id;
  }
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/tasks`, {
    method: 'POST',
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${await accessTokenFor(creator)}`,
      'Content-Profile': 'taskapp',
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ title, group_id: groupId, owner_id: await userId(creator), ...fields }),
  });
  if (!response.ok) throw new Error(`tasks: ${response.status} ${await response.text()}`);
  const [task] = (await response.json()) as { id: string }[];
  return task!.id;
}
