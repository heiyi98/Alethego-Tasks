import type { Messages } from './messages';

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
    location: '地点',
    subtasks: '子任务',
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
