/**
 * 快速添加：只需标题即可创建任务，其余字段之后在详情中补充。
 * 返回去除首尾空白后的标题；为空时返回 null（不创建任务）。
 */
export function normalizeTaskTitle(input: string): string | null {
  const title = input.trim();
  return title.length > 0 ? title : null;
}
