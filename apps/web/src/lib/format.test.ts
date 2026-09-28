import { describe, expect, it } from 'vitest';

import { formatDeadline } from './format';

const TZ = 'Asia/Shanghai';
// 测试进程时区固定为 Asia/Shanghai（见 vitest.config.ts）
const now = new Date('2026-09-28T02:00:00Z'); // 本地 9月28日 10:00

describe('formatDeadline', () => {
  it('只精确到天的截止时间不显示时刻', () => {
    expect(formatDeadline(new Date('2026-09-29T15:59:59.999Z'), now, TZ)).toBe('明天');
    expect(formatDeadline(new Date('2026-09-30T15:59:59.999Z'), now, TZ)).toBe('9月30日');
  });

  it('带具体时刻的旧数据照常显示时刻', () => {
    expect(formatDeadline(new Date('2026-09-29T01:00:00Z'), now, TZ)).toBe('明天 09:00');
    expect(formatDeadline(new Date('2026-09-27T12:30:00Z'), now, TZ)).toBe('昨天 20:30');
  });
});
