import type {
  ImportanceKey,
  Ordinal,
  RaciRole,
  RecurrencePeriod,
  RecurrenceRuleSpec,
  Weekday,
} from '@alethego/core';
import type { TaskNotificationField } from '@alethego/data';

/**
 * 界面文案（目前用于重要性的名字、通知、RACI 的称呼和循环规则）。多语言以英文（en.ts）为翻译标杆。每一块文字、每个字段名都有自己的键；
 * 以后加语言只需要再写一份同样结构的 Messages，然后在 index.ts 里切换。
 */
export interface Messages {
  /** 对象是收到通知的人自己时 */
  you: string;
  /** 重要性四档的名字（每档一个键；英文是 Must / Should / Could / Optional） */
  importance: Record<ImportanceKey, string>;
  /** RACI 四个角色的全称 */
  raciRoles: Record<RaciRole, string>;
  /** "修改"里的字段名 */
  fields: Record<TaskNotificationField, string>;
  /** 循环规则：编辑界面上的名字，和简介行里的一句话描述 */
  recurrence: {
    /** 日、周、月、年 */
    periods: Record<RecurrencePeriod, string>;
    /** 星期的短名，周一在前 */
    weekdays: Record<Weekday, string>;
    /** 第几个：1–4、最后一个（选择框里的名字） */
    ordinals: Record<Ordinal, string>;
    /** 年周：第 N 周（选择框里的名字） */
    weekNumber: (week: number) => string;
    /** 月份的短名（1–12） */
    months: readonly string[];
    /** 月里的"最后一天" */
    lastDay: string;
    /** 月：按日 / 按周 */
    monthModes: { day: string; weekday: string };
    /** 年：月日 / 月周 / 年周 */
    yearModes: { monthDay: string; monthWeekday: string; weekNumber: string };
    /** "每 N 日 / 周 / 月 / 年"里，数字前后的字 */
    every: { before: string; after: Record<RecurrencePeriod, string> };
    /** 加一行条件 */
    addRow: string;
    /** 一句话描述规则，例如"每月第 2、4 个周二" */
    describe: (spec: RecurrenceRuleSpec) => string;
  };
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
