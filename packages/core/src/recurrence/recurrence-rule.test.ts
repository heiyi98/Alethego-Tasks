import { describe, expect, it } from 'vitest';

import { occurrencesBetween } from './recurrence-engine';
import {
  LAST_DAY_OF_MONTH,
  buildRecurrenceRule,
  defaultRecurrenceSpec,
  describeRecurrence,
  parseRecurrenceRule,
  untilFromLocalDate,
  validateRecurrenceSpec,
  weekdayOf,
  type RecurrenceRuleSpec,
} from './recurrence-rule';

const timeZone = 'Asia/Shanghai';
const sh = (local: string) => new Date(`${local}+08:00`);

const spec = (fields: Partial<RecurrenceRuleSpec>): RecurrenceRuleSpec => ({
  frequency: 'daily',
  interval: 1,
  weekdays: [],
  monthDays: [],
  end: { kind: 'never' },
  ...fields,
});

describe('buildRecurrenceRule / parseRecurrenceRule', () => {
  it.each([
    [spec({}), 'FREQ=DAILY'],
    [spec({ interval: 3 }), 'FREQ=DAILY;INTERVAL=3'],
    [spec({ frequency: 'weekly', weekdays: ['FR', 'MO', 'WE'] }), 'FREQ=WEEKLY;BYDAY=MO,WE,FR'],
    [
      spec({ frequency: 'monthly', monthDays: [LAST_DAY_OF_MONTH, 15, 1] }),
      'FREQ=MONTHLY;BYMONTHDAY=1,15,-1',
    ],
    [spec({ frequency: 'yearly', end: { kind: 'count', count: 5 } }), 'FREQ=YEARLY;COUNT=5'],
    [
      spec({ end: { kind: 'until', until: new Date('2026-12-31T15:59:59.999Z') } }),
      'FREQ=DAILY;UNTIL=20261231T155959Z',
    ],
  ])('%j → %s，且能解析回来', (input, expected) => {
    const rule = buildRecurrenceRule(input);
    expect(rule).toBe(expected);
    expect(buildRecurrenceRule(parseRecurrenceRule(rule)!)).toBe(expected);
  });

  it('解析时忽略 RRULE: 前缀、DTSTART 行与大小写', () => {
    expect(parseRecurrenceRule('DTSTART:20260101T000000Z\nrrule:freq=weekly;byday=mo')).toEqual(
      spec({ frequency: 'weekly', weekdays: ['MO'] }),
    );
  });

  it('超出可编辑子集的规则返回 null', () => {
    expect(parseRecurrenceRule('FREQ=MONTHLY;BYDAY=+1MO')).toBeNull();
    expect(parseRecurrenceRule('FREQ=HOURLY')).toBeNull();
    expect(parseRecurrenceRule('FREQ=DAILY;BYHOUR=9')).toBeNull();
    expect(parseRecurrenceRule('FREQ=DAILY;BYDAY=MO')).toBeNull();
    expect(parseRecurrenceRule('FREQ=DAILY;COUNT=2;UNTIL=20261231')).toBeNull();
    expect(parseRecurrenceRule('garbage')).toBeNull();
  });
});

describe('describeRecurrence', () => {
  it.each([
    [spec({}), '每天'],
    [spec({ interval: 2 }), '每 2 天'],
    [spec({ frequency: 'weekly', weekdays: ['MO', 'WE', 'FR'] }), '每周一、三、五'],
    [spec({ frequency: 'weekly', interval: 2, weekdays: ['SA'] }), '每 2 周的周六'],
    [spec({ frequency: 'monthly', monthDays: [1, 15] }), '每月1、15号'],
    [spec({ frequency: 'monthly', monthDays: [1, LAST_DAY_OF_MONTH] }), '每月1号和最后一天'],
    [
      spec({ frequency: 'monthly', interval: 3, monthDays: [LAST_DAY_OF_MONTH] }),
      '每 3 个月的最后一天',
    ],
    [spec({ frequency: 'yearly', end: { kind: 'count', count: 10 } }), '每年，共 10 次'],
    [
      spec({
        end: { kind: 'until', until: untilFromLocalDate(sh('2026-12-31T08:00:00'), timeZone) },
      }),
      '每天，到 2026年12月31日为止',
    ],
  ])('%j → %s', (input, expected) => {
    expect(describeRecurrence(input, timeZone)).toBe(expected);
  });
});

describe('defaults & validation', () => {
  it('默认：每周，起始日所在的星期几（按用户时区）', () => {
    // UTC 周五 20:00 = 上海周六 04:00
    const dtstart = new Date('2026-09-25T20:00:00Z');
    expect(weekdayOf(dtstart, timeZone)).toBe('SA');
    expect(defaultRecurrenceSpec(dtstart, timeZone)).toMatchObject({
      frequency: 'weekly',
      weekdays: ['SA'],
      monthDays: [26],
    });
  });

  it('校验', () => {
    expect(validateRecurrenceSpec(spec({ frequency: 'weekly' }))).toBe('no_weekday');
    expect(validateRecurrenceSpec(spec({ frequency: 'monthly' }))).toBe('no_month_day');
    expect(validateRecurrenceSpec(spec({ interval: 0 }))).toBe('bad_interval');
    expect(validateRecurrenceSpec(spec({ end: { kind: 'count', count: 0 } }))).toBe('bad_count');
    expect(validateRecurrenceSpec(spec({ frequency: 'weekly', weekdays: ['MO'] }))).toBeNull();
  });

  it('生成的规则可被引擎正确展开：每月最后一天', () => {
    const rule = buildRecurrenceRule(
      spec({ frequency: 'monthly', monthDays: [LAST_DAY_OF_MONTH] }),
    );
    const dates = occurrencesBetween(
      { rule, dtstart: sh('2026-01-01T09:00:00') },
      sh('2026-01-01T00:00:00'),
      sh('2026-04-01T00:00:00'),
      timeZone,
    );
    expect(dates).toEqual([
      sh('2026-01-31T09:00:00'),
      sh('2026-02-28T09:00:00'),
      sh('2026-03-31T09:00:00'),
    ]);
  });

  it('UNTIL 取所选日期的本地日终点：当天的实例仍包含在内', () => {
    const until = untilFromLocalDate(sh('2026-09-30T00:00:00'), timeZone);
    const rule = buildRecurrenceRule(spec({ end: { kind: 'until', until } }));
    const dates = occurrencesBetween(
      { rule, dtstart: sh('2026-09-28T21:00:00') },
      sh('2026-09-28T00:00:00'),
      sh('2026-10-05T00:00:00'),
      timeZone,
    );
    expect(dates.at(-1)).toEqual(sh('2026-09-30T21:00:00'));
  });
});
