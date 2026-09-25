/**
 * 重要性（Y 轴）：用户手动选择，0-5 共六档。
 * 0 = 未设置（任务创建时的默认值），1-5 为用户主动设置的档位。
 */
export type ImportanceLevel = 0 | 1 | 2 | 3 | 4 | 5;

export const IMPORTANCE_UNSET = 0 satisfies ImportanceLevel;
export const IMPORTANCE_MIN = 0;
export const IMPORTANCE_MAX = 5;

/** 重要/不重要分界：importance_level ≥ 该值算"重要"（3-5 重要，0-2 不重要）。 */
export const IMPORTANT_THRESHOLD = 3;

export function isImportanceLevel(value: unknown): value is ImportanceLevel {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= IMPORTANCE_MIN &&
    value <= IMPORTANCE_MAX
  );
}

export function isImportant(level: ImportanceLevel): boolean {
  return level >= IMPORTANT_THRESHOLD;
}
