import { describe, expect, it } from 'vitest';

import { formatDeadline, recurrenceLabel } from './format';

const today = '2026-09-28'; // 周一

describe('formatDeadline：日期 + 星期 · 剩余天数（只到哪一天）', () => {
  it('以后：日期 + 星期 · 还剩 N 天', () => {
    expect(formatDeadline('2026-09-30', today)).toBe('9月30日 周三 · 还剩2天');
    expect(formatDeadline('2026-09-29', today)).toBe('9月29日 周二 · 还剩1天');
  });

  it('当天显示"今天"（那一天过完才算过去）', () => {
    expect(formatDeadline('2026-09-28', today)).toBe('今天');
  });

  it('已过期：逾期 N 天', () => {
    expect(formatDeadline('2026-09-26', today)).toBe('9月26日 周六 · 逾期2天');
    expect(formatDeadline('2026-09-27', today)).toBe('9月27日 周日 · 逾期1天');
  });

  it('非今年带年份', () => {
    expect(formatDeadline('2027-01-05', today)).toBe('2027年1月5日 周二 · 还剩99天');
  });
});

describe('recurrenceLabel：简介行里的一句话', () => {
  it.each([
    ['FREQ=DAILY', '每天'],
    ['FREQ=DAILY;INTERVAL=3', '每 3 天'],
    ['FREQ=WEEKLY;WKST=MO;BYDAY=MO,WE,FR', '每周一、三、五'],
    ['FREQ=WEEKLY;INTERVAL=2;WKST=MO;BYDAY=TU', '每 2 周的周二'],
    ['FREQ=MONTHLY;BYMONTHDAY=1,15', '每月 1、15 日'],
    ['FREQ=MONTHLY;BYMONTHDAY=1,-1', '每月 1 日、最后一天'],
    ['FREQ=MONTHLY;BYDAY=2TU,4TU', '每月第 2、4 个周二'],
    ['FREQ=MONTHLY;BYDAY=-1FR', '每月最后一个周五'],
    ['FREQ=YEARLY;BYMONTH=1,4,7,10;BYMONTHDAY=15', '每年 1、4、7、10 月 15 日'],
    ['FREQ=YEARLY;WKST=MO;BYWEEKNO=42;BYDAY=MO', '每年第 42 周周一'],
    ['FREQ=YEARLY;BYMONTH=3;BYDAY=2MO', '每年 3 月第 2 个周一'],
    ['FREQ=YEARLY;WKST=MO;BYWEEKNO=-1;BYDAY=MO', '每年最后一周周一'],
    ['FREQ=YEARLY;WKST=MO;BYWEEKNO=1,-1;BYDAY=SU', '每年第 1 周周日、最后一周周日'],
  ])('%s → %s', (rule, text) => {
    expect(recurrenceLabel(rule)).toBe(text);
  });
});
