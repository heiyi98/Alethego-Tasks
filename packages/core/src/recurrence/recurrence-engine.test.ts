import { describe, expect, it } from 'vitest';

import type { OccurrenceStatus, RecurrenceOccurrence } from '../domain/occurrence';
import { gregorian } from './calendar';
import {
  iterateOccurrences,
  nextOccurrence,
  occurrencesBetween,
  reconcileOccurrences,
  resolveRepresentativeInstance,
  seriesFromTask,
  type RecurrenceSeries,
} from './recurrence-engine';
import { buildRecurrenceRule, type RecurrenceRuleSpec } from './recurrence-rule';

const timeZone = 'Asia/Shanghai';
const at = (local: string) => ({ now: new Date(`${local}+08:00`), timeZone });

/** 规则从 start 起的前 n 次 */
function first(
  spec: Partial<RecurrenceRuleSpec> & Pick<RecurrenceRuleSpec, 'pattern'>,
  start: string,
  n: number,
) {
  const full: RecurrenceRuleSpec = { interval: 1, end: { kind: 'never' }, ...spec };
  const result: string[] = [];
  for (const date of iterateOccurrences(full, start)) {
    result.push(date);
    if (result.length >= n) break;
  }
  return result;
}

// 周一 / 三 / 五 健身；2026-09-21 是周一
const gym: RecurrenceSeries = { rule: 'FREQ=WEEKLY;WKST=MO;BYDAY=MO,WE,FR', start: '2026-09-21' };

const record = (
  id: string,
  occurrenceDate: string,
  status: OccurrenceStatus,
): RecurrenceOccurrence => ({
  id,
  taskId: 'task-1',
  occurrenceDate,
  status,
  completedAt: status === 'completed' ? new Date(`${occurrenceDate}T12:00:00+08:00`) : null,
  createdAt: new Date(`${occurrenceDate}T12:00:00+08:00`),
});

describe('历法模块（公历）', () => {
  it('星期、月末、第几个星期几、ISO 周', () => {
    expect(gregorian.weekdayOf('2026-10-12')).toBe(0); // 周一
    expect(gregorian.daysInMonth(2028, 2)).toBe(29);
    expect(gregorian.daysInMonth(2026, 2)).toBe(28);
    expect(gregorian.dateOf(2026, 2, 31)).toBe('2026-02-28');
    expect(gregorian.nthWeekdayOfMonth(2026, 10, 1, 2)).toBe('2026-10-13'); // 10 月第 2 个周二
    expect(gregorian.nthWeekdayOfMonth(2026, 10, 4, -1)).toBe('2026-10-30'); // 最后一个周五
    expect(gregorian.nthWeekdayOfMonth(2026, 10, 3, 5)).toBe('2026-10-29'); // 有第 5 个周四
    expect(gregorian.nthWeekdayOfMonth(2026, 2, 0, 5)).toBeNull();
    // ISO 8601：包含当年第一个星期四的那一周是第 1 周
    expect(gregorian.dateOfWeek(2026, 1, 0)).toBe('2025-12-29');
    expect(gregorian.dateOfWeek(2026, 42, 0)).toBe('2026-10-12');
    expect(gregorian.dateOfWeek(2026, 53, 0)).toBe('2026-12-28'); // 2026 年有 53 周
    expect(gregorian.dateOfWeek(2027, 53, 0)).toBeNull();
    expect(gregorian.weekYearOf('2027-01-01')).toBe(2026);
    expect(gregorian.weekYearOf('2025-12-29')).toBe(2026);
    expect(gregorian.weekOf('2026-10-12')).toBe(42);
    expect(gregorian.weekOf('2027-01-01')).toBe(53);
  });
});

describe('日、周', () => {
  it('每 N 日：从开始日期起', () => {
    expect(first({ pattern: { period: 'day' }, interval: 3 }, '2026-10-30', 4)).toEqual([
      '2026-10-30',
      '2026-11-02',
      '2026-11-05',
      '2026-11-08',
    ]);
  });

  it('每周多选；第一次是开始日期起第一个符合的日子', () => {
    // 2026-10-14 是周三
    expect(first({ pattern: { period: 'week', weekdays: ['MO', 'FR'] } }, '2026-10-14', 4)).toEqual(
      ['2026-10-16', '2026-10-19', '2026-10-23', '2026-10-26'],
    );
  });

  it('每 2 周：从开始日期所在的那一周数起（周一开始）', () => {
    expect(
      first({ pattern: { period: 'week', weekdays: ['MO', 'SU'] }, interval: 2 }, '2026-10-14', 4),
    ).toEqual(['2026-10-18', '2026-10-26', '2026-11-01', '2026-11-09']);
  });
});

describe('月', () => {
  it('按日多选，含"最后一天"', () => {
    expect(
      first({ pattern: { period: 'month', by: 'day', days: [1, 15, 'last'] } }, '2026-10-02', 5),
    ).toEqual(['2026-10-15', '2026-10-31', '2026-11-01', '2026-11-15', '2026-11-30']);
  });

  it('短月份：选了 29、30、31 日落到当月最后一天；和"最后一天"重合只算一次', () => {
    expect(
      first({ pattern: { period: 'month', by: 'day', days: [30, 31, 'last'] } }, '2027-01-01', 6),
    ).toEqual(['2027-01-30', '2027-01-31', '2027-02-28', '2027-03-30', '2027-03-31', '2027-04-30']);
    expect(first({ pattern: { period: 'month', by: 'day', days: [29] } }, '2028-01-01', 3)).toEqual(
      ['2028-01-29', '2028-02-29', '2028-03-29'],
    );
  });

  it('按周：第 2、4 个周二；最后一个周五；多行条件', () => {
    expect(
      first(
        {
          pattern: {
            period: 'month',
            by: 'weekday',
            rows: [
              { ordinal: 2, weekdays: ['TU'] },
              { ordinal: 4, weekdays: ['TU'] },
              { ordinal: -1, weekdays: ['FR'] },
            ],
          },
        },
        '2026-10-01',
        6,
      ),
    ).toEqual(['2026-10-13', '2026-10-27', '2026-10-30', '2026-11-10', '2026-11-24', '2026-11-27']);
  });

  it('每 3 月：从开始日期所在的月数起', () => {
    expect(
      first({ pattern: { period: 'month', by: 'day', days: [15] }, interval: 3 }, '2026-10-20', 3),
    ).toEqual(['2027-01-15', '2027-04-15', '2027-07-15']);
  });
});

describe('年', () => {
  it('月日：每个月选不同的日子；2 月 29 日平年落到 2 月 28 日', () => {
    expect(
      first(
        { pattern: { period: 'year', by: 'monthDay', days: { 2: [29], 4: [1, 15] } } },
        '2027-01-01',
        5,
      ),
    ).toEqual(['2027-02-28', '2027-04-01', '2027-04-15', '2028-02-29', '2028-04-01']);
  });

  it('月周：3 月第 2 个周一、5 月最后一个周五', () => {
    expect(
      first(
        {
          pattern: {
            period: 'year',
            by: 'monthWeekday',
            rows: [
              { month: 3, ordinal: 2, weekdays: ['MO'] },
              { month: 5, ordinal: -1, weekdays: ['FR'] },
            ],
          },
        },
        '2027-01-01',
        3,
      ),
    ).toEqual(['2027-03-08', '2027-05-28', '2028-03-13']);
  });

  it('年周（ISO 8601）：第 42 周周一；第 53 周只在有 53 周的年份出现', () => {
    expect(
      first(
        { pattern: { period: 'year', by: 'weekNumber', rows: [{ week: 42, weekdays: ['MO'] }] } },
        '2026-01-01',
        3,
      ),
    ).toEqual(['2026-10-12', '2027-10-18', '2028-10-16']);
    expect(
      first(
        { pattern: { period: 'year', by: 'weekNumber', rows: [{ week: 53, weekdays: ['TH'] }] } },
        '2026-01-01',
        2,
      ),
    ).toEqual(['2026-12-31', '2032-12-30']);
    // 第 1 周可以从上一年的 12 月开始
    expect(
      first(
        { pattern: { period: 'year', by: 'weekNumber', rows: [{ week: 1, weekdays: ['MO'] }] } },
        '2025-12-01',
        2,
      ),
    ).toEqual(['2025-12-29', '2027-01-04']);
  });

  it('每 2 年', () => {
    expect(
      first(
        { pattern: { period: 'year', by: 'monthDay', days: { 10: [15] } }, interval: 2 },
        '2026-11-01',
        2,
      ),
    ).toEqual(['2028-10-15', '2030-10-15']);
  });
});

describe('结束条件', () => {
  it('次数、截止日期（含）', () => {
    expect(
      first({ pattern: { period: 'day' }, end: { kind: 'count', count: 2 } }, '2026-10-01', 5),
    ).toEqual(['2026-10-01', '2026-10-02']);
    expect(
      first(
        { pattern: { period: 'day' }, end: { kind: 'until', until: '2026-10-03' } },
        '2026-10-01',
        5,
      ),
    ).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
  });
});

describe('存成 RRULE 后照样推算（多行 RRULE 取并集）', () => {
  it('年的月日写成几行，推算结果不变', () => {
    const rule = buildRecurrenceRule({
      pattern: { period: 'year', by: 'monthDay', days: { 1: [15], 4: [15], 6: [1] } },
      interval: 1,
      end: { kind: 'never' },
    });
    expect(rule.split('\n')).toHaveLength(2);
    expect(occurrencesBetween({ rule, start: '2026-01-01' }, '2026-01-01', '2026-12-31')).toEqual([
      '2026-01-15',
      '2026-04-15',
      '2026-06-01',
    ]);
  });
});

describe('seriesFromTask / nextOccurrence', () => {
  it('循环开关关闭时返回 null', () => {
    expect(seriesFromTask({ recurrenceRule: null, recurrenceStartOn: '2026-09-21' })).toBeNull();
    expect(seriesFromTask({ recurrenceRule: gym.rule, recurrenceStartOn: '2026-09-21' })).toEqual(
      gym,
    );
  });

  it('下一次；序列结束后为 null', () => {
    expect(nextOccurrence(gym, '2026-09-23', false)).toBe('2026-09-25');
    expect(nextOccurrence(gym, '2026-09-23')).toBe('2026-09-23');
    const twice = { ...gym, rule: 'FREQ=WEEKLY;WKST=MO;BYDAY=MO,WE,FR;COUNT=2' };
    expect(nextOccurrence(twice, '2026-09-24')).toBeNull();
  });
});

describe('resolveRepresentativeInstance：最早一个还没完成、日期还没过去的那一次', () => {
  it('那一天过完才算过去：周三当天（不管几点）代表还是周三', () => {
    expect(resolveRepresentativeInstance(gym, [], at('2026-09-23T23:59:00'))).toEqual({
      occurrenceDate: '2026-09-23',
    });
    expect(resolveRepresentativeInstance(gym, [], at('2026-09-24T00:00:00'))).toEqual({
      occurrenceDate: '2026-09-25',
    });
  });

  it('按用户时区的本地日期判断', () => {
    // 上海已经是周四，UTC 还是周三
    const context = { now: new Date('2026-09-24T01:00:00+08:00'), timeZone };
    expect(resolveRepresentativeInstance(gym, [], context)?.occurrenceDate).toBe('2026-09-25');
    const utc = { now: new Date('2026-09-24T01:00:00+08:00'), timeZone: 'UTC' };
    expect(resolveRepresentativeInstance(gym, [], utc)?.occurrenceDate).toBe('2026-09-23');
  });

  it('提前完成的被跳过，连续多次也能跳过', () => {
    const records = [
      record('fri', '2026-09-25', 'completed'),
      record('mon', '2026-09-28', 'completed'),
    ];
    expect(
      resolveRepresentativeInstance(gym, records, at('2026-09-24T08:00:00'))?.occurrenceDate,
    ).toBe('2026-09-30');
  });

  it('开始日期在未来 → 第一次；序列已结束 → null', () => {
    expect(resolveRepresentativeInstance(gym, [], at('2026-09-01T08:00:00'))?.occurrenceDate).toBe(
      '2026-09-21',
    );
    const twice = { ...gym, rule: 'FREQ=WEEKLY;WKST=MO;BYDAY=MO,WE,FR;COUNT=2' };
    expect(resolveRepresentativeInstance(twice, [], at('2026-09-24T08:00:00'))).toBeNull();
  });

  it('改第二行的日期 = 换开始日期：从这天起重新排', () => {
    const moved = { ...gym, start: '2026-10-07' };
    expect(
      resolveRepresentativeInstance(moved, [], at('2026-09-24T08:00:00'))?.occurrenceDate,
    ).toBe('2026-10-07');
    expect(occurrencesBetween(moved, '2026-10-01', '2026-10-12')).toEqual([
      '2026-10-07',
      '2026-10-09',
      '2026-10-12',
    ]);
  });
});

describe('reconcileOccurrences：日期过去了还没勾选，记为未完成', () => {
  it('周三当天不归档；周四起周三记为 missed', () => {
    const records = [record('mon', '2026-09-21', 'completed')];
    expect(reconcileOccurrences(gym, records, at('2026-09-23T23:00:00'))).toEqual({
      toCreate: [],
      toMarkMissed: [],
    });
    expect(reconcileOccurrences(gym, records, at('2026-09-24T00:01:00'))).toEqual({
      toCreate: [{ occurrenceDate: '2026-09-23', status: 'missed' }],
      toMarkMissed: [],
    });
  });

  it('已有的 pending 记录日期一过改为 missed', () => {
    const records = [record('wed', '2026-09-23', 'pending')];
    expect(reconcileOccurrences(gym, records, at('2026-09-24T08:00:00')).toMarkMissed).toEqual([
      'wed',
    ]);
  });

  it('长期未打开：补建所有已经过去的', () => {
    expect(reconcileOccurrences(gym, [], at('2026-09-26T12:00:00')).toCreate).toEqual([
      { occurrenceDate: '2026-09-21', status: 'missed' },
      { occurrenceDate: '2026-09-23', status: 'missed' },
      { occurrenceDate: '2026-09-25', status: 'missed' },
    ]);
  });

  it('提前完成了未来的那一次，之前已经过去的照样补建', () => {
    const records = [
      record('mon', '2026-09-21', 'completed'),
      record('next', '2026-09-28', 'completed'),
    ];
    expect(reconcileOccurrences(gym, records, at('2026-09-26T08:00:00')).toCreate).toEqual([
      { occurrenceDate: '2026-09-23', status: 'missed' },
      { occurrenceDate: '2026-09-25', status: 'missed' },
    ]);
  });

  it('默认从已过去的最新一条记录往后补；给了 backfillFrom 则从那里补齐缺的', () => {
    const records = [record('fri', '2026-09-25', 'missed')];
    expect(reconcileOccurrences(gym, records, at('2026-09-29T08:00:00')).toCreate).toEqual([
      { occurrenceDate: '2026-09-28', status: 'missed' },
    ]);
    expect(
      reconcileOccurrences(gym, records, at('2026-09-29T08:00:00'), { backfillFrom: '2026-09-21' })
        .toCreate,
    ).toEqual([
      { occurrenceDate: '2026-09-21', status: 'missed' },
      { occurrenceDate: '2026-09-23', status: 'missed' },
      { occurrenceDate: '2026-09-28', status: 'missed' },
    ]);
  });
});
