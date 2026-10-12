import {
  normalizePattern,
  type MonthDay,
  type Ordinal,
  type OrdinalWeekdays,
  type RecurrenceRuleSpec,
  type Weekday,
} from '@alethego/core';

import type { Messages } from './messages';

const EN_WEEKDAYS: Record<Weekday, string> = {
  MO: 'Mon',
  TU: 'Tue',
  WE: 'Wed',
  TH: 'Thu',
  FR: 'Fri',
  SA: 'Sat',
  SU: 'Sun',
};
const EN_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const list = (items: readonly string[]) =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
const ordinalNumber = (n: number) =>
  n % 100 >= 11 && n % 100 <= 13 ? `${n}th` : `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const enDays = (days: readonly Weekday[]) => list(days.map((d) => EN_WEEKDAYS[d]));
const enMonthDays = (days: readonly MonthDay[]) =>
  list(days.map((d) => (d === 'last' ? 'last day' : ordinalNumber(d))));
const enOrdinalRows = (rows: readonly OrdinalWeekdays[]) => {
  const groups = new Map<string, Ordinal[]>();
  for (const row of rows) {
    const key = row.weekdays.join(',');
    groups.set(key, [...(groups.get(key) ?? []), row.ordinal]);
  }
  return list(
    [...groups.entries()].map(
      ([key, ordinals]) =>
        `the ${list(ordinals.map((o) => (o === -1 ? 'last' : ordinalNumber(o))))} ${enDays(key.split(',') as Weekday[])}`,
    ),
  );
};

function enDescribe(spec: RecurrenceRuleSpec): string {
  const pattern = normalizePattern(spec.pattern);
  const n = spec.interval;
  const every = (unit: string) => (n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`);
  let text: string;
  switch (pattern.period) {
    case 'day':
      text = every('day');
      break;
    case 'week':
      text = `${every('week')} on ${enDays(pattern.weekdays)}`;
      break;
    case 'month':
      text = `${every('month')} on ${
        pattern.by === 'day' ? `the ${enMonthDays(pattern.days)}` : enOrdinalRows(pattern.rows)
      }`;
      break;
    case 'year': {
      if (pattern.by === 'monthDay') {
        const groups = new Map<string, number[]>();
        for (const [month, days] of Object.entries(pattern.days)) {
          const key = days.join(',');
          groups.set(key, [...(groups.get(key) ?? []), Number(month)]);
        }
        text = `${every('year')} on ${list(
          [...groups.entries()].map(
            ([key, months]) =>
              `the ${list(key.split(',').map((d) => ordinalNumber(Number(d))))} of ${list(months.map((m) => EN_MONTHS[m - 1]!))}`,
          ),
        )}`;
      } else if (pattern.by === 'monthWeekday') {
        const byMonth = new Map<number, OrdinalWeekdays[]>();
        for (const row of pattern.rows)
          byMonth.set(row.month, [...(byMonth.get(row.month) ?? []), row]);
        text = `${every('year')} on ${list(
          [...byMonth.entries()].map(
            ([month, rows]) => `${enOrdinalRows(rows)} of ${EN_MONTHS[month - 1]}`,
          ),
        )}`;
      } else {
        const groups = new Map<string, number[]>();
        for (const row of pattern.rows) {
          const key = row.weekdays.join(',');
          groups.set(key, [...(groups.get(key) ?? []), row.week]);
        }
        text = `${every('year')} ${list(
          [...groups.entries()].map(
            ([key, weeks]) =>
              `in week ${list(weeks.map(String))} on ${enDays(key.split(',') as Weekday[])}`,
          ),
        )}`;
      }
      break;
    }
  }
  if (spec.end.kind === 'count') text += `, ${spec.end.count} times`;
  if (spec.end.kind === 'until') text += `, until ${spec.end.until}`;
  return text;
}

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
    subtasks: 'subtasks',
  },
  recurrence: {
    periods: { day: 'Day', week: 'Week', month: 'Month', year: 'Year' },
    weekdays: EN_WEEKDAYS,
    ordinals: { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', [-1]: 'Last' } as Record<Ordinal, string>,
    weekNumber: (week) => `Week ${week}`,
    months: EN_MONTHS,
    lastDay: 'Last day',
    monthModes: { day: 'Day', weekday: 'Week' },
    yearModes: { monthDay: 'Month day', monthWeekday: 'Month week', weekNumber: 'Year week' },
    every: {
      before: 'Every',
      after: { day: 'day(s)', week: 'week(s)', month: 'month(s)', year: 'year(s)' },
    },
    addRow: 'Add a condition',
    describe: enDescribe,
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
