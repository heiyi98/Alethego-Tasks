import { RACI_ROLES } from '@alethego/core';
import type { MemberTaskRole } from '@alethego/data';

/**
 * 某人在任务上的 R、A、C、I：每条任务一行，后面是他在这条任务上的字母；
 * 跨项目列出时（踢出组、退出组）任务前面是项目名。
 */
export function RaciRolesList({
  roles,
  showProject = false,
}: {
  roles: readonly MemberTaskRole[];
  showProject?: boolean;
}) {
  const byTask = new Map<string, { title: string; project: string; letters: string[] }>();
  for (const role of roles) {
    const entry = byTask.get(role.taskId) ?? {
      title: role.taskTitle,
      project: role.projectName,
      letters: [],
    };
    entry.letters.push(role.role);
    byTask.set(role.taskId, entry);
  }
  return (
    <ul className="raci-roles-list">
      {[...byTask].map(([taskId, entry]) => (
        <li key={taskId}>
          {showProject && <span className="raci-roles-project">{entry.project}</span>}
          <span className="raci-roles-task">{entry.title}</span>
          <span className="raci-letters">
            {RACI_ROLES.filter((r) => entry.letters.includes(r)).join(' ')}
          </span>
        </li>
      ))}
    </ul>
  );
}
