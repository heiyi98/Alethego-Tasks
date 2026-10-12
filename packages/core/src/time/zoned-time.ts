/**
 * 时区相关的纯函数工具。
 *
 * 具体到时刻的时间（完成时间、创建时间等）一律是 UTC 时间点（Date）；只到某一天的日期（截止日期、
 * 循环的日期）是 "YYYY-MM-DD"。"今天是哪一天"按用户所在时区判断，这里提供基于 Intl 的换算，
 * 不依赖运行环境的系统时区。
 *
 * 术语：
 * - instant（时间点）：真实的 UTC 时间点。
 * - wall time（墙上时间）：某时区下的本地日期时间，用一个"UTC 字段即本地字段"的 Date 表示
 *   （即 floating time）。仅在本模块和循环规则计算内部使用，不要泄漏给上层。
 */

const MS_PER_DAY = 86_400_000;

/** 领域计算所需的上下文：当前时间 + 用户时区（IANA 名称，如 "Asia/Shanghai"）。 */
export interface EvaluationContext {
  now: Date;
  timeZone: string;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** 时间点 → 该时区下的墙上时间。 */
export function toWallTime(instant: Date, timeZone: string): Date {
  const fields: Record<string, number> = {};
  for (const part of getFormatter(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') fields[part.type] = Number(part.value);
  }
  return new Date(
    Date.UTC(
      fields.year!,
      fields.month! - 1,
      fields.day!,
      fields.hour!,
      fields.minute!,
      fields.second!,
      instant.getUTCMilliseconds(),
    ),
  );
}

/** 墙上时间 → 时间点。夏令时跳过的墙上时间会被顺延到跳变之后。 */
export function fromWallTime(wall: Date, timeZone: string): Date {
  const target = wall.getTime();
  // 两次迭代修正偏移量，覆盖夏令时切换附近的情况
  let guess = target - (toWallTime(new Date(target), timeZone).getTime() - target);
  guess = target - (toWallTime(new Date(guess), timeZone).getTime() - guess);
  return new Date(guess);
}

/** 用户本地的今天（"YYYY-MM-DD"） */
export function todayOf(context: EvaluationContext): string {
  return toWallTime(context.now, context.timeZone).toISOString().slice(0, 10);
}

/** 某个日期（"YYYY-MM-DD"）在该时区结束的时刻（23:59:59.999） */
export function endOfDay(date: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const nextDayStart = fromWallTime(new Date(Date.UTC(y!, m! - 1, d! + 1)), timeZone);
  return new Date(nextDayStart.getTime() - 1);
}

/** 时间点在该时区下所属日历日的序号（自 1970-01-01 起的天数），用于日历日差计算。 */
export function localDayNumber(instant: Date, timeZone: string): number {
  return Math.floor(toWallTime(instant, timeZone).getTime() / MS_PER_DAY);
}

/** 两个时间点之间相差的日历日数（to 的日期 − from 的日期），按用户时区计算。 */
export function calendarDaysBetween(from: Date, to: Date, timeZone: string): number {
  return localDayNumber(to, timeZone) - localDayNumber(from, timeZone);
}

/** 时间点所在本地日的起点（00:00:00.000）。 */
export function startOfLocalDay(instant: Date, timeZone: string): Date {
  return fromWallTime(new Date(localDayNumber(instant, timeZone) * MS_PER_DAY), timeZone);
}

/** 时间点所在本地日的终点（23:59:59.999）。 */
export function endOfLocalDay(instant: Date, timeZone: string): Date {
  const nextDayStart = fromWallTime(
    new Date((localDayNumber(instant, timeZone) + 1) * MS_PER_DAY),
    timeZone,
  );
  return new Date(nextDayStart.getTime() - 1);
}
