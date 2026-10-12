import { describe, expect, it } from 'vitest';

import {
  buildRecurrenceRule,
  isEmptyPattern,
  isValidRecurrenceRule,
  normalizePattern,
  parseRecurrenceRule,
  validateRecurrenceSpec,
  type RecurrenceRuleSpec,
} from './recurrence-rule';

const spec = (pattern: RecurrenceRuleSpec['pattern'], interval = 1): RecurrenceRuleSpec => ({
  pattern,
  interval,
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
    [
      '每年最后一周周日（和"最后一天""最后一个"同一套写法：-1）',
      spec({
        period: 'year',
        by: 'weekNumber',
        rows: [
          { week: -1, weekdays: ['SU'] },
          { week: 1, weekdays: ['SU'] },
        ],
      }),
      'FREQ=YEARLY;WKST=MO;BYWEEKNO=1,-1;BYDAY=SU',
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

  it('没有结束条件：COUNT、UNTIL 不认；没有第 53 周（用"最后一周"）', () => {
    expect(isValidRecurrenceRule('FREQ=DAILY;COUNT=5')).toBe(false);
    expect(isValidRecurrenceRule('FREQ=DAILY;UNTIL=20261231')).toBe(false);
    expect(isValidRecurrenceRule('FREQ=YEARLY;WKST=MO;BYWEEKNO=53;BYDAY=MO')).toBe(false);
    expect(buildRecurrenceRule(spec({ period: 'day' }))).toBe('FREQ=DAILY');
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

describe('validateRecurrenceSpec / isEmptyPattern', () => {
  it('间隔必须是正整数', () => {
    expect(validateRecurrenceSpec(spec({ period: 'day' }, 0))).toBe('bad_interval');
    expect(validateRecurrenceSpec(spec({ period: 'day' }, 2))).toBeNull();
  });

  it('一个位置都没选 = 空（等同于没有开启循环）；"日"没有位置可选，不算空', () => {
    expect(isEmptyPattern({ period: 'day' })).toBe(false);
    expect(isEmptyPattern({ period: 'week', weekdays: [] })).toBe(true);
    expect(isEmptyPattern({ period: 'month', by: 'day', days: [] })).toBe(true);
    expect(
      isEmptyPattern({ period: 'month', by: 'weekday', rows: [{ ordinal: 1, weekdays: [] }] }),
    ).toBe(true);
    expect(isEmptyPattern({ period: 'year', by: 'monthDay', days: { 3: [] } })).toBe(true);
    expect(
      isEmptyPattern({ period: 'year', by: 'weekNumber', rows: [{ week: 1, weekdays: [] }] }),
    ).toBe(true);
    expect(isEmptyPattern({ period: 'week', weekdays: ['MO'] })).toBe(false);
    expect(
      isEmptyPattern({
        period: 'year',
        by: 'monthWeekday',
        rows: [
          { month: 1, ordinal: 1, weekdays: [] },
          { month: 2, ordinal: 1, weekdays: ['MO'] },
        ],
      }),
    ).toBe(false);
  });
});
