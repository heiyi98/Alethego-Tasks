/**
 * 重要性（Y 轴）：四档，由强到弱是 必须、应该、可以、随意（Must / Should / Could / Optional）。
 * 存储为 0-3：0 = 随意（默认档，新建任务不选就是它），1 = 可以，2 = 应该，3 = 必须。
 * 不再有"未设置重要性"。各档的判断标准写在 docs/02，界面上不加说明。
 */
export type ImportanceLevel = 0 | 1 | 2 | 3;

export const IMPORTANCE_OPTIONAL = 0 satisfies ImportanceLevel;
export const IMPORTANCE_COULD = 1 satisfies ImportanceLevel;
export const IMPORTANCE_SHOULD = 2 satisfies ImportanceLevel;
export const IMPORTANCE_MUST = 3 satisfies ImportanceLevel;

/** 默认档：随意 */
export const IMPORTANCE_DEFAULT: ImportanceLevel = IMPORTANCE_OPTIONAL;
export const IMPORTANCE_MIN = 0;
export const IMPORTANCE_MAX = 3;

/** 四档由强到弱（界面上的选项按这个顺序） */
export const IMPORTANCE_LEVELS_STRONG_FIRST: readonly ImportanceLevel[] = [3, 2, 1, 0];

/** 每一档的文案键（多语言以英文为标杆） */
export type ImportanceKey = 'must' | 'should' | 'could' | 'optional';

export const IMPORTANCE_KEYS: Record<ImportanceLevel, ImportanceKey> = {
  3: 'must',
  2: 'should',
  1: 'could',
  0: 'optional',
};

/** 重要/不重要分界：应该、必须算"重要"（矩阵中线在"应该"和"可以"之间） */
export const IMPORTANT_THRESHOLD = IMPORTANCE_SHOULD;

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
