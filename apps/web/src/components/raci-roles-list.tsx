import { RACI_ROLES } from '@alethego/core';
import type { MemberTaskRole } from '@alethego/data';

/** 某人在本组任务上的 R、A、C、I：每条任务一行，后面是他在这条任务上的字母 */
export function RaciRolesList({ roles }: { roles: readonly MemberTaskRole[] }) {
  const byTask = new Map<string, { title: string; letters: string[] }>();
  for (const role of roles) {
    const entry = byTask.get(role.taskId) ?? { title: role.taskTitle, letters: [] };
    entry.letters.push(role.role);
    byTask.set(role.taskId, entry);
  }
  return (
    <ul className="raci-roles-list">
      {[...byTask].map(([taskId, entry]) => (
        <li key={taskId}>
          <span className="raci-roles-task">{entry.title}</span>
          <span className="raci-letters">
            {RACI_ROLES.filter((r) => entry.letters.includes(r)).join(' ')}
          </span>
        </li>
      ))}
    </ul>
  );
}
