import { describe, expect, it } from 'vitest';

import { dateOfInstant } from '../schedule/calendar-date';
import { calendarDaysBetween } from '../time/zoned-time';
import { resolveRepresentativeInstance } from './recurrence-engine';

/**
 * 回归：循环任务的日期在接近午夜、跨日、不同时区时都正确。
 * 代表实例 = 时刻还没过的最早未完成实例，日期按用户时区算。
 */

const ZONES = [
  'Asia/Shanghai',
  'America/Los_Angeles',
  'America/New_York',
  'Europe/London',
  'Pacific/Kiritimati',
  'Pacific/Pago_Pago',
  'Asia/Kolkata',
];

/** 某时区的墙上时间 → 时间点（用 Intl 反推偏移） */
function at(local: string, timeZone: string): Date {
  const guess = new Date(`${local}Z`);
  const shown = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
    .format(guess)
    .replace(' ', 'T');
  const offset = new Date(`${shown}Z`).getTime() - guess.getTime();
  return new Date(guess.getTime() - offset);
}

describe.each(ZONES)('每天 23:30 的循环任务（%s）', (timeZone) => {
  const series = (dtstart: string) => ({ rule: 'FREQ=DAILY', dtstart: at(dtstart, timeZone) });

  it('23:29：代表是今天 23:30；23:31：换成明天 23:30', () => {
    const s = series('2026-10-01T23:30:00');
    const before = resolveRepresentativeInstance(s, [], {
      now: at('2026-10-05T23:29:00', timeZone),
      timeZone,
    });
    expect(dateOfInstant(before!.occurrenceAt, timeZone)).toBe('2026-10-05');
    const after = resolveRepresentativeInstance(s, [], {
      now: at('2026-10-05T23:31:00', timeZone),
      timeZone,
    });
    expect(dateOfInstant(after!.occurrenceAt, timeZone)).toBe('2026-10-06');
  });

  it('跨过午夜：00:01 的代表仍是当天 23:30（不会跳过一天，也不会退回前一天）', () => {
    const s = series('2026-10-01T23:30:00');
    const r = resolveRepresentativeInstance(s, [], {
      now: at('2026-10-06T00:01:00', timeZone),
      timeZone,
    });
    expect(dateOfInstant(r!.occurrenceAt, timeZone)).toBe('2026-10-06');
    expect(
      calendarDaysBetween(at('2026-10-06T00:01:00', timeZone), r!.occurrenceAt, timeZone),
    ).toBe(0);
  });

  it('完成当前这一次后代表顺延一天；完成的记录写的是实例的时刻', () => {
    const s = series('2026-10-01T23:30:00');
    const now = at('2026-10-05T23:59:00', timeZone);
    const current = resolveRepresentativeInstance(s, [], { now, timeZone })!;
    expect(dateOfInstant(current.occurrenceAt, timeZone)).toBe('2026-10-06');
    const next = resolveRepresentativeInstance(
      s,
      [{ occurrenceDate: current.occurrenceAt, status: 'completed' }],
      { now, timeZone },
    );
    expect(dateOfInstant(next!.occurrenceAt, timeZone)).toBe('2026-10-07');
  });
});

describe('每天 00:15 的循环任务：用户时区和 UTC 不在同一天', () => {
  it.each(ZONES)('%s：代表的日期按用户时区，不按 UTC', (timeZone) => {
    const s = { rule: 'FREQ=DAILY', dtstart: at('2026-10-01T00:15:00', timeZone) };
    const r = resolveRepresentativeInstance(s, [], {
      now: at('2026-10-05T23:50:00', timeZone),
      timeZone,
    });
    expect(dateOfInstant(r!.occurrenceAt, timeZone)).toBe('2026-10-06');
  });
});

describe('夏令时切换的那天', () => {
  it('纽约 2026-11-01（多一小时）和 2026-03-08（少一小时）：09:00 的实例日期不变', () => {
    const timeZone = 'America/New_York';
    const s = { rule: 'FREQ=DAILY', dtstart: at('2026-02-01T09:00:00', timeZone) };
    for (const day of ['2026-03-08', '2026-11-01']) {
      const r = resolveRepresentativeInstance(s, [], {
        now: at(`${day}T08:59:00`, timeZone),
        timeZone,
      });
      expect(dateOfInstant(r!.occurrenceAt, timeZone)).toBe(day);
    }
  });
});
