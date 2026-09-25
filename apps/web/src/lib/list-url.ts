/** 记住列表页的筛选 URL，从详情页返回 / 删除后回到同一筛选视图。仅为便利功能，存储不可用时退回首页。 */
const KEY = 'alethego:list-url';

export function rememberListUrl(url: string): void {
  try {
    sessionStorage.setItem(KEY, url);
  } catch {
    // 存储不可用时忽略
  }
}

export function lastListUrl(): string {
  try {
    const url = sessionStorage.getItem(KEY);
    return url?.startsWith('/') ? url : '/';
  } catch {
    return '/';
  }
}
