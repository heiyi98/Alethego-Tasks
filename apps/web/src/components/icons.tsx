import type { ReactNode, SVGProps } from 'react';

/**
 * 线性图标（风格接近 SF Symbols）。图标本身不带语义：
 * 作为按钮时用 IconButton（aria-label + title），作为字段标签时用 FieldIcon。
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable={false}
      {...props}
    >
      {children}
    </svg>
  );
}

export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
);
export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);
export const XIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);
export const CheckCircleIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12.5l2.8 2.8L16.5 9.5" />
  </Svg>
);
export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 12.5h9l1-12.5M10 11v5.5M14 11v5.5" />
  </Svg>
);
export const CalendarIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Svg>
);
export const FlagIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
  </Svg>
);
export const TextIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h16M4 11h16M4 16h10" />
  </Svg>
);
export const TagIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 12.5V4.5a1 1 0 011-1h8l8 8-9 9-8-8z" />
    <circle cx="8" cy="8" r="1.5" />
  </Svg>
);
export const RepeatIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 11V9a3 3 0 013-3h12l-3-3M20 13v2a3 3 0 01-3 3H5l3 3" />
  </Svg>
);
export const LocationIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0113 0c0 5-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.3" />
  </Svg>
);
export const PersonIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20a7 7 0 0114 0" />
  </Svg>
);
export const PersonAddIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10" cy="8" r="3.5" />
    <path d="M3.5 20a6.5 6.5 0 0113 0M19 8v6M16 11h6" />
  </Svg>
);
export const ClockIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);
export const UndoIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 010 11H11" />
  </Svg>
);
export const PencilIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15.5 4.5l4 4L8 20H4v-4z" />
  </Svg>
);
export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const WarningIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5l9.5 16.5h-19z" />
    <path d="M12 10v4.5M12 17.5v.01" />
  </Svg>
);

export const StarIcon = ({ filled, ...p }: IconProps & { filled?: boolean }) => (
  <Svg {...p} fill={filled ? 'currentColor' : 'none'}>
    <path d="M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z" />
  </Svg>
);
/** 矩阵模式（四象限） */
export const MatrixIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
    <path d="M12 3.5v17M3.5 12h17" />
  </Svg>
);
/** 清单模式 */
export const ListIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 6.5h11M9 12h11M9 17.5h11" />
    <circle cx="4.8" cy="6.5" r="1" fill="currentColor" />
    <circle cx="4.8" cy="12" r="1" fill="currentColor" />
    <circle cx="4.8" cy="17.5" r="1" fill="currentColor" />
  </Svg>
);

/** 只有图标的按钮：必须有 aria-label，悬停显示同样的文字 */
export function IconButton({
  label,
  children,
  className = '',
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'title'> & {
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`icon-button ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/** 字段标签图标：对读屏软件和悬停提示都给出字段名 */
export function FieldIcon({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="field-icon" role="img" aria-label={label} title={label}>
      {children}
    </span>
  );
}
