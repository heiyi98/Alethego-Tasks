/**
 * 登录模块：登录页、账号菜单、登录状态与续期都在这里。
 * 任务功能的代码只用 useCurrentUser()；以后改成跳转到 Alethego 统一登录中心时只替换这个模块。
 */
export { AuthProvider, useCurrentUser, type CurrentUser } from './auth-provider';
export { AccountMenu } from './account-menu';
