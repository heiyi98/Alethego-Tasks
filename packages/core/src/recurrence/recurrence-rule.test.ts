import { describe, expect, it } from 'vitest';

import {
  buildRecurrenceRule,
  isValidRecurrenceRule,
  normalizePattern,
  parseRecurrenceRule,
  validateRecurrenceSpec,
  type RecurrenceRuleSpec,
} from './recurrence-rule';

const never = { kind: 'never' } as const;
const spec = (pattern: RecurrenceRuleSpec['pattern'], interval = 1): RecurrenceRuleSpec => ({
  pattern,
  interval,
  end: never,
});

describe('结构 ⇄ RRULE（RFC 5545）', () => {
  const cases: [string, RecurrenceRuleSpec, string][] = [
    ['每 2 日', spec({ period: 'day' }, 2), 'FREQ=DAILY;INTERVAL=2'],
    [
      '每周一、三',
      spec({ period: 'week', weekdays: ['WE', 'MO'] }),
      'FREQ=WEEKLY;WKST=MO;BYDAY=MO,WE',
    ],
    [
      '每月 1、15 日、最后一天',
      spec({ period: 'month', by: 'day', days: [15, 'last', 1] }),
      'FREQ=MONTHLY;BYMONTHDAY=1,15,-1',
    ],
    [
      '每月 31 日：短月份落到最后一天（RFC 7529 SKIP=BACKWARD）',
      spec({ period: 'month', by: 'day', days: [31] }),
      'RSCALE=GREGORIAN;FREQ=MONTHLY;SKIP=BACKWARD;BYMONTHDAY=31',
    ],
    [
      '每月第 2、4 个周二',
      spec({
        period: 'month',
        by: 'weekday',
        rows: [
          { ordinal: 4, weekdays: ['TU'] },
          { ordinal: 2, weekdays: ['TU'] },
        ],
      }),
      'FREQ=MONTHLY;BYDAY=2TU,4TU',
    ],
    [
      '每月最后一个周五',
      spec({ period: 'month', by: 'weekday', rows: [{ ordinal: -1, weekdays: ['FR'] }] }),
      'FREQ=MONTHLY;BYDAY=-1FR',
    ],
    [
      '每年 1、4、7、10 月 15 日（日子相同的月份合成一条）',
      spec({ period: 'year', by: 'monthDay', days: { 1: [15], 4: [15], 7: [15], 10: [15] } }),
      'FREQ=YEARLY;BYMONTH=1,4,7,10;BYMONTHDAY=15',
    ],
    [
      '每年第 42 周周一',
      spec({ period: 'year', by: 'weekNumber', rows: [{ week: 42, weekdays: ['MO'] }] }),
      'FREQ=YEARLY;WKST=MO;BYWEEKNO=42;BYDAY=MO',
    ],
  ];
  it.each(cases)('%s', (_, value, rule) => {
    expect(buildRecurrenceRule(value)).toBe(rule);
    expect(parseRecurrenceRule(rule)).toEqual({
      ...value,
      pattern: normalizePattern(value.pattern),
    });
    expect(buildRecurrenceRule(parseRecurrenceRule(rule)!)).toBe(rule);
  });

  it('年里任意的"某月某日"组合写成几行 RRULE，读回来不变', () => {
    const value = spec({ period: 'year', by: 'monthDay', days: { 2: [29], 4: [1, 15] } });
    const rule = buildRecurrenceRule(value);
    expect(rule).toBe(
      'RRULE:RSCALE=GREGORIAN;FREQ=YEARLY;SKIP=BACKWARD;BYMONTH=2;BYMONTHDAY=29\nRRULE:FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=1,15',
    );
    expect(parseRecurrenceRule(rule)).toEqual(value);
  });

  it('年的月周：同一个月的条件合成一条，不同的月分开', () => {
    const value = spec({
      period: 'year',
      by: 'monthWeekday',
      rows: [
        { month: 3, ordinal: 2, weekdays: ['MO'] },
        { month: 5, ordinal: -1, weekdays: ['FR'] },
        { month: 3, ordinal: -1, weekdays: ['FR'] },
      ],
    });
    const rule = buildRecurrenceRule(value);
    expect(rule).toBe(
      'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2MO,-1FR\nRRULE:FREQ=YEARLY;BYMONTH=5;BYDAY=-1FR',
    );
    expect(parseRecurrenceRule(rule)?.pattern).toEqual({
      period: 'year',
      by: 'monthWeekday',
      rows: [
        { month: 3, ordinal: 2, weekdays: ['MO'] },
        { month: 3, ordinal: -1, weekdays: ['FR'] },
        { month: 5, ordinal: -1, weekdays: ['FR'] },
      ],
    });
  });

  it('结束条件：次数、截止日期', () => {
    const rule = buildRecurrenceRule({
      pattern: { period: 'day' },
      interval: 1,
      end: { kind: 'until', until: '2026-12-31' },
    });
    expect(rule).toBe('FREQ=DAILY;UNTIL=20261231');
    expect(parseRecurrenceRule(rule)?.end).toEqual({ kind: 'until', until: '2026-12-31' });
    expect(parseRecurrenceRule('FREQ=DAILY;COUNT=5')?.end).toEqual({ kind: 'count', count: 5 });
  });

  it('不认识的规则返回 null', () => {
    expect(isValidRecurrenceRule('FREQ=HOURLY')).toBe(false);
    expect(isValidRecurrenceRule('BYDAY=MO')).toBe(false);
    expect(isValidRecurrenceRule('FREQ=MONTHLY;BYDAY=5MO')).toBe(false);
    expect(isValidRecurrenceRule('FREQ=MONTHLY;BYMONTHDAY=1;BYDAY=MO')).toBe(false);
    // 同一个年里不能混用两种标尺
    expect(
      isValidRecurrenceRule(
        'RRULE:FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1\nRRULE:FREQ=YEARLY;BYMONTH=2;BYDAY=1MO',
      ),
    ).toBe(false);
  });
});

describe('validateRecurrenceSpec', () => {
  it('必须选了日子', () => {
    expect(validateRecurrenceSpec(spec({ period: 'week', weekdays: [] }))).toBe('no_weekday');
    expect(validateRecurrenceSpec(spec({ period: 'month', by: 'day', days: [] }))).toBe('no_day');
    expect(
      validateRecurrenceSpec(
        spec({ period: 'month', by: 'weekday', rows: [{ ordinal: 1, weekdays: [] }] }),
      ),
    ).toBe('no_condition');
    expect(validateRecurrenceSpec(spec({ period: 'year', by: 'monthDay', days: {} }))).toBe(
      'no_day',
    );
    expect(validateRecurrenceSpec(spec({ period: 'day' }, 0))).toBe('bad_interval');
    expect(validateRecurrenceSpec(spec({ period: 'day' }, 2))).toBeNull();
  });
});
