import { describe, expect, it } from 'vitest';

import { formatDeadline } from './format';

const TZ = 'Asia/Shanghai';
// 测试进程时区固定为 Asia/Shanghai（见 vitest.config.ts）
const now = new Date('2026-09-28T02:00:00Z'); // 本地 9月28日 周一 10:00

describe('formatDeadline：日期 + 星期 · 剩余天数', () => {
  it('以后：日期 + 星期 · 还剩 N 天（只到天的不显示时刻）', () => {
    expect(formatDeadline(new Date('2026-09-30T15:59:59.999Z'), now, TZ)).toBe(
      '9月30日 周三 · 还剩2天',
    );
    expect(formatDeadline(new Date('2026-09-29T15:59:59.999Z'), now, TZ)).toBe(
      '9月29日 周二 · 还剩1天',
    );
  });

  it('选了时刻时带上时刻；剩余天数仍按日历天算', () => {
    // 明天 09:00 距现在不到 24 小时，但仍是"还剩1天"
    expect(formatDeadline(new Date('2026-09-29T01:00:00Z'), now, TZ)).toBe(
      '9月29日 周二 09:00 · 还剩1天',
    );
  });

  it('当天显示"今天"；当天时刻已过显示"已过"', () => {
    expect(formatDeadline(new Date('2026-09-28T15:59:59.999Z'), now, TZ)).toBe('今天');
    expect(formatDeadline(new Date('2026-09-28T10:00:00Z'), now, TZ)).toBe('今天 18:00');
    expect(formatDeadline(new Date('2026-09-28T01:00:00Z'), now, TZ)).toBe('今天 09:00 · 已过');
  });

  it('已过期：逾期 N 天（按日历天）', () => {
    expect(formatDeadline(new Date('2026-09-26T15:59:59.999Z'), now, TZ)).toBe(
      '9月26日 周六 · 逾期2天',
    );
    expect(formatDeadline(new Date('2026-09-27T15:30:00Z'), now, TZ)).toBe(
      '9月27日 周日 23:30 · 逾期1天',
    );
  });

  it('非今年带年份', () => {
    expect(formatDeadline(new Date('2027-01-05T15:59:59.999Z'), now, TZ)).toBe(
      '2027年1月5日 周二 · 还剩99天',
    );
  });
});
