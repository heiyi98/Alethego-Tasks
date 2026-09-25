import * as rruleModule from 'rrule';
import type { Options as RRuleOptions } from 'rrule';

import type { OccurrenceStatus, RecurrenceOccurrence } from '../domain/occurrence';
import type { Task } from '../domain/task';
import {
  endOfLocalDay,
  fromWallTime,
  startOfLocalDay,
  toWallTime,
  type EvaluationContext,
} from '../time/zoned-time';

// rrule 的 ESM 构建只有具名导出（打包器走这条），而 Node 原生 ESM 加载它的 CommonJS 构建时
// 只能拿到 default。两种情况都兼容：
const { RRule } =
  (rruleModule as typeof rruleModule & { default?: typeof rruleModule }).default ?? rruleModule;
type RRuleInstance = InstanceType<typeof RRule>;

/**
 * 循环规则引擎：只负责循环任务下一次实例的计算、代表实例选取与历史记录归档判定。
 * 纯函数，不做任何读写；归档结果由数据层负责落库。
 *
 * 规则在用户时区的墙上时间中展开（"每周一 9 点"指用户本地的 9 点，跨夏令时也保持不变），
 * 对外输入输出一律是 UTC 时间点。
 */

/** 循环序列：规则 + 起始时间。 */
export interface RecurrenceSeries {
  /** RFC 5545 RRULE，可带或不带 "RRULE:" 前缀；其中的 DTSTART 会被忽略 */
  rule: string;
  dtstart: Date;
}

/** 代表实例：循环任务此刻提供给矩阵等下游视图的那一次实例。 */
export interface RepresentativeInstance {
  /** 实例对应的时间点 */
  occurrenceAt: Date;
  /** 实例所在本地日的终点；用作紧迫度计算的截止时间（实例在日期过去之前都不算逾期） */
  dueAt: Date;
}

/** 需要新建的实例记录。 */
export interface NewOccurrence {
  occurrenceDate: Date;
  status: Extract<OccurrenceStatus, 'pending' | 'missed'>;
}

/** 归档判定结果：由数据层执行。 */
export interface ReconcileResult {
  toCreate: NewOccurrence[];
  /** 需要改为 missed 的已有 pending 记录 id */
  toMarkMissed: string[];
}

/** 向后查找代表实例时最多跳过的已完成实例数，防止异常数据导致死循环。 */
const MAX_REPRESENTATIVE_SCAN = 1000;

/** 单次归档最多补建的实例记录数（长期未打开应用时，只补最近的这部分）。 */
export const MAX_BACKFILL_OCCURRENCES = 500;

/** 从任务取出循环序列；循环开关关闭（无规则）或缺少起始时间时返回 null。 */
export function seriesFromTask(
  task: Pick<Task, 'recurrenceRule' | 'recurrenceDtstart'>,
): RecurrenceSeries | null {
  if (!task.recurrenceRule || !task.recurrenceDtstart) return null;
  return { rule: task.recurrenceRule, dtstart: task.recurrenceDtstart };
}

export function isValidRecurrenceRule(rule: string): boolean {
  try {
    const options = RRule.parseString(rule);
    return options.freq !== undefined;
  } catch {
    return false;
  }
}

function buildRule(series: RecurrenceSeries, timeZone: string): RRuleInstance {
  const parsed: Partial<RRuleOptions> = RRule.parseString(series.rule);
  const options: Partial<RRuleOptions> = {
    ...parsed,
    dtstart: toWallTime(series.dtstart, timeZone),
    tzid: null,
  };
  if (parsed.until) options.until = toWallTime(parsed.until, timeZone);
  return new RRule(options);
}

function toInstant(wall: Date | null, timeZone: string): Date | null {
  return wall ? fromWallTime(wall, timeZone) : null;
}

/** [from, to] 区间内（含端点）的所有实例时间点。 */
export function occurrencesBetween(
  series: RecurrenceSeries,
  from: Date,
  to: Date,
  timeZone: string,
): Date[] {
  return buildRule(series, timeZone)
    .between(toWallTime(from, timeZone), toWallTime(to, timeZone), true)
    .map((wall) => fromWallTime(wall, timeZone));
}

/** 某时间点之后的下一次实例；inclusive 为 true 时包含该时间点本身。序列结束时返回 null。 */
export function nextOccurrence(
  series: RecurrenceSeries,
  after: Date,
  timeZone: string,
  inclusive = false,
): Date | null {
  return toInstant(
    buildRule(series, timeZone).after(toWallTime(after, timeZone), inclusive),
    timeZone,
  );
}

/**
 * 代表实例 = 日期未过去的、最早的未完成实例。
 *
 * - "日期未过去"按用户时区的日历日判断：今天的实例即使具体时刻已过，今天之内仍是代表实例；
 *   一旦日期过去，它立刻不再是代表实例（不论是否已归档为 missed）。
 * - 已标记完成的实例被跳过，代表实例顺延到下一次。
 * - 与归档（reconcileOccurrences）完全解耦：这里只看日期和完成状态。
 *
 * 序列已结束（COUNT/UNTIL 用尽）时返回 null。
 */
export function resolveRepresentativeInstance(
  series: RecurrenceSeries,
  occurrences: readonly Pick<RecurrenceOccurrence, 'occurrenceDate' | 'status'>[],
  context: EvaluationContext,
): RepresentativeInstance | null {
  const { now, timeZone } = context;
  const rule = buildRule(series, timeZone);
  const completed = new Set(
    occurrences.filter((o) => o.status === 'completed').map((o) => o.occurrenceDate.getTime()),
  );

  let wall = rule.after(toWallTime(startOfLocalDay(now, timeZone), timeZone), true);
  for (let scanned = 0; wall && scanned < MAX_REPRESENTATIVE_SCAN; scanned++) {
    const occurrenceAt = fromWallTime(wall, timeZone);
    if (!completed.has(occurrenceAt.getTime())) {
      return { occurrenceAt, dueAt: endOfLocalDay(occurrenceAt, timeZone) };
    }
    wall = rule.after(wall, false);
  }
  return null;
}

/**
 * 归档判定：
 * - 实例所在日期到来（本地日期 ≤ 今天）时，应存在一条记录；缺失的记录补建。
 * - 一旦后续实例已经出现，之前仍为 pending 的实例判定为 missed。
 *   补建时若该实例已被后续实例取代，直接以 missed 建立。
 *
 * 归档可以滞后执行（例如用户打开应用时才调用），不影响代表实例的选取。
 * 只处理 pending → missed；completed 与用户手动修改过的 missed 记录不会被改动。
 */
export function reconcileOccurrences(
  series: RecurrenceSeries,
  existing: readonly Pick<RecurrenceOccurrence, 'id' | 'occurrenceDate' | 'status'>[],
  context: EvaluationContext,
): ReconcileResult {
  const { now, timeZone } = context;
  const rule = buildRule(series, timeZone);
  const todayEnd = endOfLocalDay(now, timeZone);

  const latestAppeared = toInstant(rule.before(toWallTime(todayEnd, timeZone), true), timeZone);
  if (!latestAppeared) return { toCreate: [], toMarkMissed: [] };

  // 只从已有记录中最晚的那一条往后补建，避免每次重新展开整个历史
  const scanFrom = existing.reduce<Date>(
    (latest, o) => (o.occurrenceDate > latest ? o.occurrenceDate : latest),
    series.dtstart,
  );
  const existingKeys = new Set(existing.map((o) => o.occurrenceDate.getTime()));
  const statusFor = (date: Date): NewOccurrence['status'] =>
    date.getTime() < latestAppeared.getTime() ? 'missed' : 'pending';

  const toCreate = occurrencesBetween(series, scanFrom, todayEnd, timeZone)
    .filter((date) => !existingKeys.has(date.getTime()))
    .slice(-MAX_BACKFILL_OCCURRENCES)
    .map((occurrenceDate) => ({ occurrenceDate, status: statusFor(occurrenceDate) }));

  const toMarkMissed = existing
    .filter((o) => o.status === 'pending' && statusFor(o.occurrenceDate) === 'missed')
    .map((o) => o.id);

  return { toCreate, toMarkMissed };
}
