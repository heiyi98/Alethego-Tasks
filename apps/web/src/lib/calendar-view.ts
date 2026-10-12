import { gregorian, type CalendarSystem } from '@alethego/core';

/**
 * 选日子界面用的历法：一个"月"的网格怎么排、标题怎么写。以后加入其他历法（例如农历）时，
 * 再写一个实现这个接口的对象，日历右上角的"切换历法"位置放一个切换按钮即可。现在只有公历，不显示按钮。
 * 存进数据库的始终是公历日期（"YYYY-MM-DD"）。
 */
export interface CalendarView {
  id: string;
  /** 某天所在的"月"（用来决定打开时显示哪个月） */
  monthOf(date: string): { year: number; month: number };
  /** 前一个 / 后一个月 */
  shiftMonth(view: { year: number; month: number }, delta: number): { year: number; month: number };
  /** 月的标题，例如"2026年10月" */
  monthTitle(view: { year: number; month: number }): string;
  /** 这个月的每一天（公历日期）和格子里显示的数字 */
  days(view: { year: number; month: number }): { date: string; label: string }[];
  /** 第一天前面空几格（每周从周一开始） */
  leadingBlanks(view: { year: number; month: number }): number;
  /** 读屏用的完整日期，例如"2026年10月12日" */
  accessibleName(date: string): string;
}

export function gregorianView(calendar: CalendarSystem = gregorian): CalendarView {
  return {
    id: calendar.id,
    monthOf: (date) => ({ year: calendar.yearOf(date), month: calendar.monthOf(date) }),
    shiftMonth: ({ year, month }, delta) => {
      const index = year * 12 + (month - 1) + delta;
      return { year: Math.floor(index / 12), month: (index % 12) + 1 };
    },
    monthTitle: ({ year, month }) => `${year}年${month}月`,
    days: ({ year, month }) =>
      Array.from({ length: calendar.daysInMonth(year, month) }, (_, i) => ({
        date: calendar.dateOf(year, month, i + 1),
        label: String(i + 1),
      })),
    leadingBlanks: ({ year, month }) => calendar.weekdayOf(calendar.dateOf(year, month, 1)),
    accessibleName: (date) =>
      `${calendar.yearOf(date)}年${calendar.monthOf(date)}月${calendar.dayOf(date)}日`,
  };
}

export const GREGORIAN_VIEW = gregorianView();
