import type { RaciRole } from '@alethego/core';
import type { TaskNotificationField } from '@alethego/data';

/**
 * 界面文案（目前只用于通知和 RACI 的称呼）。每一块文字、每个字段名都有自己的键；
 * 以后加语言只需要再写一份同样结构的 Messages，然后在 index.ts 里切换。
 */
export interface Messages {
  /** 对象是收到通知的人自己时 */
  you: string;
  /** RACI 四个角色的全称 */
  raciRoles: Record<RaciRole, string>;
  /** "修改"里的字段名 */
  fields: Record<TaskNotificationField, string>;
  /** 把几项连成一串：两项用"和"，更多项用"、"再用"和"接最后一项 */
  joinList: (items: readonly string[]) => string;
  /** 一句通知由几块拼成：操作者、动作、对象、任务、改了哪些内容 */
  notification: {
    groupInvitation: (p: { actor: string; group: string }) => string;
    groupDeletionVote: (p: { actor: string; group: string }) => string;
    groupLeaderVote: (p: { actor: string; subject: string; group: string }) => string;
    projectInvitation: (p: { actor: string; group: string; project: string }) => string;
    projectDeletionVote: (p: { actor: string; group: string; project: string }) => string;
    assigned: (p: { actor: string; subject: string; task: string; role: string }) => string;
    completed: (p: { actor: string; task: string }) => string;
    confirmed: (p: { actor: string; task: string }) => string;
    rejected: (p: { actor: string; task: string }) => string;
    modified: (p: { actor: string; task: string; fields: string }) => string;
    deleted: (p: { actor: string; task: string }) => string;
    restored: (p: { actor: string; task: string }) => string;
  };
}
