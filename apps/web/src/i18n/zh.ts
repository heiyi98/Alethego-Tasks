import {
  normalizePattern,
  type MonthDay,
  type Ordinal,
  type OrdinalWeekdays,
  type RecurrenceRuleSpec,
  type Weekday,
} from '@alethego/core';

import type { Messages } from './messages';

const ZH_WEEKDAYS: Record<Weekday, string> = {
  MO: '一',
  TU: '二',
  WE: '三',
  TH: '四',
  FR: '五',
  SA: '六',
  SU: '日',
};
const zhDays = (days: readonly Weekday[]) => `周${days.map((d) => ZH_WEEKDAYS[d]).join('、')}`;
const zhMonthDays = (days: readonly MonthDay[]) => {
  const numbers = days.filter((d): d is number => d !== 'last');
  const parts = numbers.length > 0 ? [`${numbers.join('、')} 日`] : [];
  if (days.includes('last')) parts.push('最后一天');
  return parts.join('、');
};
/** 同一组星期的几个"第几个"合成一句：第 2、4 个周二 */
const zhOrdinalRows = (rows: readonly OrdinalWeekdays[]) => {
  const groups = new Map<string, Ordinal[]>();
  for (const row of rows) {
    const key = row.weekdays.join(',');
    groups.set(key, [...(groups.get(key) ?? []), row.ordinal]);
  }
  return [...groups.entries()]
    .map(([key, ordinals]) => {
      const days = zhDays(key.split(',') as Weekday[]);
      const numbers = ordinals.filter((o) => o !== -1);
      const parts = numbers.length > 0 ? [`第 ${numbers.join('、')} 个${days}`] : [];
      if (ordinals.includes(-1)) parts.push(`最后一个${days}`);
      return parts.join('、');
    })
    .join('，');
};

function zhDescribe(spec: RecurrenceRuleSpec): string {
  const pattern = normalizePattern(spec.pattern);
  const n = spec.interval;
  const every = (unit: string) => (n === 1 ? `每${unit}` : `每 ${n} ${unit}`);
  let text: string;
  switch (pattern.period) {
    case 'day':
      text = n === 1 ? '每天' : `每 ${n} 天`;
      break;
    case 'week':
      text = n === 1 ? `每${zhDays(pattern.weekdays)}` : `每 ${n} 周的${zhDays(pattern.weekdays)}`;
      break;
    case 'month':
      // 数字前空一格：每月 1、15 日；每月第 2、4 个周二
      text = `${n === 1 ? '每月' : `每 ${n} 个月`}${
        pattern.by === 'day' ? ` ${zhMonthDays(pattern.days)}` : zhOrdinalRows(pattern.rows)
      }`;
      break;
    case 'year': {
      const head = every('年');
      if (pattern.by === 'monthDay') {
        const groups = new Map<string, number[]>();
        for (const [month, days] of Object.entries(pattern.days)) {
          const key = days.join(',');
          groups.set(key, [...(groups.get(key) ?? []), Number(month)]);
        }
        text =
          `${head} ` +
          [...groups.entries()]
            .map(([key, months]) => `${months.join('、')} 月 ${key.split(',').join('、')} 日`)
            .join('，');
      } else if (pattern.by === 'monthWeekday') {
        const byMonth = new Map<number, OrdinalWeekdays[]>();
        for (const row of pattern.rows)
          byMonth.set(row.month, [...(byMonth.get(row.month) ?? []), row]);
        text =
          `${head} ` +
          [...byMonth.entries()]
            .map(([month, rows]) => `${month} 月${zhOrdinalRows(rows)}`)
            .join('，');
      } else {
        const groups = new Map<string, number[]>();
        for (const row of pattern.rows) {
          const key = row.weekdays.join(',');
          groups.set(key, [...(groups.get(key) ?? []), row.week]);
        }
        text =
          head +
          [...groups.entries()]
            .map(([key, weeks]) => {
              const days = zhDays(key.split(',') as Weekday[]);
              const numbers = weeks.filter((w) => w !== -1);
              const parts = numbers.length > 0 ? [`第 ${numbers.join('、')} 周${days}`] : [];
              if (weeks.includes(-1)) parts.push(`最后一周${days}`);
              return parts.join('、');
            })
            .join('，');
      }
      break;
    }
  }
  return text;
}

export const zh: Messages = {
  you: '你',
  importance: {
    must: '必须',
    should: '应该',
    could: '可以',
    optional: '随意',
  },
  raciRoles: {
    R: '执行人（R）',
    A: '负责人（A）',
    C: '顾问（C）',
    I: '知会（I）',
  },
  fields: {
    title: '标题',
    description: '描述',
    deadline: '截止时间',
    importance: '重要性',
    recurrence: '循环',
    deleted: '删除',
    restored: '恢复',
    R: '执行人（R）',
    A: '负责人（A）',
    C: '顾问（C）',
    I: '知会（I）',
    people: '人物',
    subtasks: '子任务',
  },
  recurrence: {
    periods: { day: '日', week: '周', month: '月', year: '年' },
    weekdays: ZH_WEEKDAYS,
    ordinals: {
      1: '第 1 个',
      2: '第 2 个',
      3: '第 3 个',
      4: '第 4 个',
      [-1]: '最后一个',
    } as Record<Ordinal, string>,
    weekNumber: (week) => (week === -1 ? '最后一周' : `第 ${week} 周`),
    months: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
    lastDay: '最后一天',
    monthModes: { day: '日', weekday: '周' },
    yearModes: { monthDay: '月日', monthWeekday: '月周', weekNumber: '年周' },
    every: { before: '每', after: { day: '日', week: '周', month: '月', year: '年' } },
    addRow: '加一行条件',
    describe: zhDescribe,
  },
  joinList: (items) =>
    items.length <= 1
      ? (items[0] ?? '')
      : `${items.slice(0, -1).join('、')}和${items[items.length - 1]}`,
  notification: {
    groupInvitation: ({ actor, group }) => `${actor}邀请你加入「${group}」`,
    groupDeletionVote: ({ actor, group }) => `${actor}发起删除「${group}」`,
    groupLeaderVote: ({ actor, subject, group }) =>
      `${actor}提议任命${subject}为「${group}」的组长`,
    projectInvitation: ({ actor, group, project }) =>
      `${actor}邀请你加入「${group}」的「${project}」`,
    projectDeletionVote: ({ actor, group, project }) =>
      `${actor}发起删除「${group}」的「${project}」`,
    assigned: ({ actor, subject, task, role }) => `${actor}把${subject}设为${task}的${role}`,
    completed: ({ actor, task }) => `${actor}完成了${task}`,
    confirmed: ({ actor, task }) => `${actor}确认了${task}`,
    rejected: ({ actor, task }) => `${actor}退回了${task}`,
    modified: ({ actor, task, fields }) => `${actor}修改了${task}的${fields}`,
    deleted: ({ actor, task }) => `${actor}删除了${task}`,
    restored: ({ actor, task }) => `${actor}恢复了${task}`,
  },
};
