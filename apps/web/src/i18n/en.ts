import type { Messages } from './messages';

/** 英文：多语言的翻译标杆（其他语言按这一份的键和意思翻译） */
export const en: Messages = {
  you: 'you',
  importance: {
    must: 'Must',
    should: 'Should',
    could: 'Could',
    optional: 'Optional',
  },
  raciRoles: {
    R: 'Responsible (R)',
    A: 'Accountable (A)',
    C: 'Consulted (C)',
    I: 'Informed (I)',
  },
  fields: {
    title: 'title',
    description: 'description',
    deadline: 'due date',
    importance: 'priority',
    recurrence: 'repeat',
    deleted: 'deletion',
    restored: 'restoration',
    R: 'Responsible (R)',
    A: 'Accountable (A)',
    C: 'Consulted (C)',
    I: 'Informed (I)',
    people: 'people',
    location: 'location',
    subtasks: 'subtasks',
  },
  joinList: (items) =>
    items.length <= 1
      ? (items[0] ?? '')
      : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`,
  notification: {
    groupInvitation: ({ actor, group }) => `${actor} invited you to "${group}"`,
    groupDeletionVote: ({ actor, group }) => `${actor} proposed deleting "${group}"`,
    groupLeaderVote: ({ actor, subject, group }) =>
      `${actor} proposed ${subject} as a leader of "${group}"`,
    projectInvitation: ({ actor, group, project }) =>
      `${actor} invited you to "${project}" in "${group}"`,
    projectDeletionVote: ({ actor, group, project }) =>
      `${actor} proposed deleting "${project}" in "${group}"`,
    assigned: ({ actor, subject, task, role }) => `${actor} made ${subject} ${role} of ${task}`,
    completed: ({ actor, task }) => `${actor} completed ${task}`,
    confirmed: ({ actor, task }) => `${actor} confirmed ${task}`,
    rejected: ({ actor, task }) => `${actor} sent back ${task}`,
    modified: ({ actor, task, fields }) => `${actor} changed the ${fields} of ${task}`,
    deleted: ({ actor, task }) => `${actor} deleted ${task}`,
    restored: ({ actor, task }) => `${actor} restored ${task}`,
  },
};
