import { describe, expect, it } from 'vitest';

import type { OccurrenceStatus, RecurrenceOccurrence } from '../domain/occurrence';
import {
  isValidRecurrenceRule,
  nextOccurrence,
  occurrencesBetween,
  reconcileOccurrences,
  resolveRepresentativeInstance,
  seriesFromTask,
  type RecurrenceSeries,
} from './recurrence-engine';

const timeZone = 'Asia/Shanghai';
const sh = (local: string) => new Date(`${local}+08:00`);
const at = (local: string) => ({ now: sh(local), timeZone });

// 周一/三/五 07:00 健身；2026-09-21 是周一
const gym: RecurrenceSeries = {
  rule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
  dtstart: sh('2026-09-21T07:00:00'),
};
const MON = sh('2026-09-21T07:00:00');
const WED = sh('2026-09-23T07:00:00');
const FRI = sh('2026-09-25T07:00:00');
const NEXT_MON = sh('2026-09-28T07:00:00');

const record = (
  id: string,
  occurrenceDate: Date,
  status: OccurrenceStatus,
): RecurrenceOccurrence => ({
  id,
  taskId: 'task-1',
  occurrenceDate,
  status,
  completedAt: status === 'completed' ? occurrenceDate : null,
  createdAt: occurrenceDate,
});

describe('seriesFromTask', () => {
  it('循环开关关闭时返回 null', () => {
    expect(seriesFromTask({ recurrenceRule: null, recurrenceDtstart: MON })).toBeNull();
    expect(seriesFromTask({ recurrenceRule: gym.rule, recurrenceDtstart: MON })).toEqual(gym);
  });
});

describe('isValidRecurrenceRule', () => {
  it('识别合法与非法规则', () => {
    expect(isValidRecurrenceRule('FREQ=DAILY')).toBe(true);
    expect(isValidRecurrenceRule('RRULE:FREQ=WEEKLY;BYDAY=MO')).toBe(true);
    expect(isValidRecurrenceRule('BYDAY=MO')).toBe(false);
    expect(isValidRecurrenceRule('not a rule')).toBe(false);
  });
});

describe('occurrencesBetween / nextOccurrence', () => {
  it('在用户时区展开规则，结果为 UTC 时间点', () => {
    expect(occurrencesBetween(gym, MON, NEXT_MON, timeZone)).toEqual([MON, WED, FRI, NEXT_MON]);
  });

  it('下一次实例', () => {
    expect(nextOccurrence(gym, WED, timeZone)).toEqual(FRI);
    expect(nextOccurrence(gym, WED, timeZone, true)).toEqual(WED);
  });

  it('跨夏令时保持本地墙上时间不变', () => {
    const daily: RecurrenceSeries = {
      rule: 'FREQ=DAILY',
      dtstart: new Date('2026-10-31T09:00:00-04:00'), // EDT
    };
    // 2026-11-01 纽约夏令时结束
    expect(
      occurrencesBetween(
        daily,
        new Date('2026-10-31T00:00:00Z'),
        new Date('2026-11-03T00:00:00Z'),
        'America/New_York',
      ),
    ).toEqual([
      new Date('2026-10-31T13:00:00Z'),
      new Date('2026-11-01T14:00:00Z'),
      new Date('2026-11-02T14:00:00Z'),
    ]);
  });

  it('序列结束后返回 null', () => {
    const twice = { ...gym, rule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=2' };
    expect(nextOccurrence(twice, WED, timeZone)).toBeNull();
  });
});

describe('resolveRepresentativeInstance', () => {
  it('周三没做，周四这天代表实例是周五而不是周三', () => {
    const records = [record('mon', MON, 'completed'), record('wed', WED, 'pending')];
    expect(resolveRepresentativeInstance(gym, records, at('2026-09-24T10:00:00'))).toEqual({
      occurrenceAt: FRI,
      dueAt: sh('2026-09-25T23:59:59.999'),
    });
  });

  it('不依赖归档：周三记录尚未写入 missed 也不影响切换', () => {
    expect(resolveRepresentativeInstance(gym, [], at('2026-09-24T00:00:00'))?.occurrenceAt).toEqual(
      FRI,
    );
  });

  it('实例当天之内都是代表实例，即使具体时刻已过', () => {
    expect(resolveRepresentativeInstance(gym, [], at('2026-09-23T23:59:00'))?.occurrenceAt).toEqual(
      WED,
    );
  });

  it('当天实例已完成 → 顺延到下一次', () => {
    const records = [record('fri', FRI, 'completed')];
    expect(
      resolveRepresentativeInstance(gym, records, at('2026-09-25T08:00:00'))?.occurrenceAt,
    ).toEqual(NEXT_MON);
  });

  it('连续多个实例提前完成也能跳过', () => {
    const records = [record('fri', FRI, 'completed'), record('mon', NEXT_MON, 'completed')];
    expect(
      resolveRepresentativeInstance(gym, records, at('2026-09-25T08:00:00'))?.occurrenceAt,
    ).toEqual(sh('2026-09-30T07:00:00'));
  });

  it('起始时间在未来 → 第一次实例', () => {
    expect(resolveRepresentativeInstance(gym, [], at('2026-09-01T08:00:00'))?.occurrenceAt).toEqual(
      MON,
    );
  });

  it('序列已结束 → null', () => {
    const twice = { ...gym, rule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=2' };
    expect(resolveRepresentativeInstance(twice, [], at('2026-09-24T08:00:00'))).toBeNull();
  });
});

describe('reconcileOccurrences', () => {
  it('周四：周三仍是 pending，还不归档（下一实例尚未出现）', () => {
    const records = [record('mon', MON, 'completed'), record('wed', WED, 'pending')];
    expect(reconcileOccurrences(gym, records, at('2026-09-24T10:00:00'))).toEqual({
      toCreate: [],
      toMarkMissed: [],
    });
  });

  it('周五当天：周三归档为 missed，并生成周五的 pending 记录（不必等到 07:00）', () => {
    const records = [record('mon', MON, 'completed'), record('wed', WED, 'pending')];
    expect(reconcileOccurrences(gym, records, at('2026-09-25T00:30:00'))).toEqual({
      toCreate: [{ occurrenceDate: FRI, status: 'pending' }],
      toMarkMissed: ['wed'],
    });
  });

  it('长期未打开：补建记录，被取代的直接以 missed 建立', () => {
    expect(reconcileOccurrences(gym, [], at('2026-09-25T12:00:00'))).toEqual({
      toCreate: [
        { occurrenceDate: MON, status: 'missed' },
        { occurrenceDate: WED, status: 'missed' },
        { occurrenceDate: FRI, status: 'pending' },
      ],
      toMarkMissed: [],
    });
  });

  it('不改动已完成或用户手动修改过的记录', () => {
    const records = [
      record('mon', MON, 'completed'),
      record('wed', WED, 'missed'),
      record('fri', FRI, 'completed'),
    ];
    expect(reconcileOccurrences(gym, records, at('2026-09-28T09:00:00'))).toEqual({
      toCreate: [{ occurrenceDate: NEXT_MON, status: 'pending' }],
      toMarkMissed: [],
    });
  });

  it('尚无实例出现时什么都不做', () => {
    expect(reconcileOccurrences(gym, [], at('2026-09-20T12:00:00'))).toEqual({
      toCreate: [],
      toMarkMissed: [],
    });
  });
});
