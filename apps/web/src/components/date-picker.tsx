'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { CalendarIcon, ChevronDownIcon, IconButton, XIcon } from './icons';
import { messages } from '@/i18n';
import { GREGORIAN_VIEW, type CalendarView } from '@/lib/calendar-view';
import { formatDate, toDateValue } from '@/lib/format';

const WEEK_HEADER = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

/**
 * 选日子：点开是日历（一个月一页，每周从周一开始）。只选到"哪一天"，没有时刻。
 * 日历右上角是"切换历法"的位置：calendarSwitch 传进来就显示（现在不传，位置留着）；
 * 换历法时传另一个 calendar（见 lib/calendar-view.ts），存的仍是公历日期。
 */
export function DatePicker({
  value,
  onChange,
  label,
  readOnly = false,
  clearable = true,
  min,
  calendar = GREGORIAN_VIEW,
  calendarSwitch,
}: {
  /** "YYYY-MM-DD"；空字符串 = 没选 */
  value: string;
  onChange: (value: string) => void;
  /** 读屏名字，也是 E2E 找它的名字 */
  label: string;
  /** 只显示、不能点（例如由任务关系算出来的日期） */
  readOnly?: boolean;
  clearable?: boolean;
  /** 不能选比它早的日子 */
  min?: string;
  calendar?: CalendarView;
  calendarSwitch?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const today = toDateValue(new Date());
  const [view, setView] = useState(() => calendar.monthOf(value || today));
  const root = useRef<HTMLDivElement>(null);

  // 点日历外面、按 Esc 收起
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const toggle = () => {
    if (readOnly) return;
    if (!open) setView(calendar.monthOf(value || today));
    setOpen((o) => !o);
  };

  return (
    <div className="date-picker" ref={root}>
      <button
        type="button"
        className={`date-trigger${value ? '' : ' date-trigger-empty'}${readOnly ? ' date-trigger-readonly' : ''}`}
        aria-label={label}
        aria-haspopup={readOnly ? undefined : 'dialog'}
        aria-expanded={readOnly ? undefined : open}
        aria-disabled={readOnly || undefined}
        data-value={value}
        onClick={toggle}
      >
        <CalendarIcon size={16} />
        {value && <span className="date-trigger-text">{formatDate(value, today)}</span>}
      </button>
      {value && clearable && !readOnly && (
        <IconButton
          label={`清除${label}`}
          className="icon-button-small"
          onClick={() => onChange('')}
        >
          <XIcon size={14} />
        </IconButton>
      )}
      {open && (
        <div className="date-popover" role="dialog" aria-label="选择时间">
          <div className="date-popover-header">
            <IconButton
              label="上个月"
              className="icon-button-small date-nav-prev"
              onClick={() => setView((v) => calendar.shiftMonth(v, -1))}
            >
              <ChevronDownIcon size={16} />
            </IconButton>
            <span className="date-popover-title" aria-live="polite">
              {calendar.monthTitle(view)}
            </span>
            <IconButton
              label="下个月"
              className="icon-button-small date-nav-next"
              onClick={() => setView((v) => calendar.shiftMonth(v, 1))}
            >
              <ChevronDownIcon size={16} />
            </IconButton>
            {/* 切换历法的位置（现在不显示按钮） */}
            <span className="date-calendar-switch" data-slot="calendar-switch">
              {calendarSwitch}
            </span>
          </div>
          <div className="date-grid" role="grid">
            {WEEK_HEADER.map((d) => (
              <span key={d} className="date-grid-weekday" aria-hidden>
                {messages.recurrence.weekdays[d]}
              </span>
            ))}
            {Array.from({ length: calendar.leadingBlanks(view) }, (_, i) => (
              <span key={`blank-${i}`} />
            ))}
            {calendar.days(view).map(({ date, label: dayLabel }) => (
              <button
                key={date}
                type="button"
                className={`date-cell${date === today ? ' date-cell-today' : ''}`}
                aria-label={calendar.accessibleName(date)}
                aria-pressed={date === value}
                disabled={Boolean(min && date < min)}
                onClick={() => {
                  onChange(date);
                  setOpen(false);
                }}
              >
                {dayLabel}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
