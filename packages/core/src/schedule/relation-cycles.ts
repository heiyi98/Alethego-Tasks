/**
 * 任务关系不能形成循环（A 等 B、B 又等 A）。只看任务之间的依赖，不分开始和结束。
 */

export interface DependencyEdge {
  /** 依赖别人的任务 */
  taskId: string;
  /** 被依赖的任务（前置） */
  predecessorId: string;
}

/** 让 taskId 依赖 predecessorId 会不会形成循环：从前置往上找，能找回 taskId 就是循环 */
export function wouldCreateCycle(
  edges: readonly DependencyEdge[],
  taskId: string,
  predecessorId: string,
): boolean {
  if (taskId === predecessorId) return true;
  const preds = predecessorsMap(edges);
  const seen = new Set<string>();
  const stack = [predecessorId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(preds.get(id) ?? []));
  }
  return false;
}

/** 找出一个循环（任务 id 依次排列，首尾相接）；没有循环时为 null */
export function findCycle(edges: readonly DependencyEdge[]): string[] | null {
  const preds = predecessorsMap(edges);
  const state = new Map<string, 'visiting' | 'done'>();
  const path: string[] = [];
  const visit = (id: string): string[] | null => {
    const s = state.get(id);
    if (s === 'done') return null;
    if (s === 'visiting') return path.slice(path.indexOf(id));
    state.set(id, 'visiting');
    path.push(id);
    for (const p of preds.get(id) ?? []) {
      const cycle = visit(p);
      if (cycle) return cycle;
    }
    path.pop();
    state.set(id, 'done');
    return null;
  };
  for (const id of preds.keys()) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return null;
}

/** 拓扑顺序：前置排在依赖它的任务前面；有循环时抛错 */
export function topologicalOrder(
  ids: readonly string[],
  edges: readonly DependencyEdge[],
): string[] {
  const set = new Set(ids);
  const inner = edges.filter((e) => set.has(e.taskId) && set.has(e.predecessorId));
  const indegree = new Map(ids.map((id) => [id, 0]));
  const successors = new Map<string, string[]>();
  for (const e of inner) {
    indegree.set(e.taskId, indegree.get(e.taskId)! + 1);
    successors.set(e.predecessorId, [...(successors.get(e.predecessorId) ?? []), e.taskId]);
  }
  const queue = ids.filter((id) => indegree.get(id) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of successors.get(id) ?? []) {
      indegree.set(next, indegree.get(next)! - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  if (order.length !== ids.length) throw new Error('任务关系形成了循环');
  return order;
}

function predecessorsMap(edges: readonly DependencyEdge[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const e of edges) map.set(e.taskId, [...(map.get(e.taskId) ?? []), e.predecessorId]);
  return map;
}
