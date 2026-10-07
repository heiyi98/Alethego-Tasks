'use client';

import { RACI_ROLES } from '@alethego/core';

import { useCurrentGroup } from '@/components/current-group';
import { usePanels } from '@/components/panel-provider';
import { useSelection } from '@/components/selection';
import { useTaskData } from '@/components/task-data-provider';
import { ViewFrame } from '@/components/view-frame';
import { useVisibleTasks } from '@/hooks/use-visible-tasks';
import { PersonName } from '@/components/person-name';
import { STATUS_LABELS } from '@/lib/format';

/**
 * 责任分配矩阵（开了任务分配的项目）：每一行是一条任务，每一列是项目名单里的一个人（成员在前，只有名字的人在后），
 * 格子里写这个人在这条任务上的 R、A、C、I，没有就空着。和清单共用同一个状态行；
 * 这一轮只能看，不能在表格里改（点任务名打开任务详情）。人多时左右滑动。
 */
export function RaciMatrixView() {
  return (
    // 和清单同样的宽度：切换看法时标题和添加栏不动；表格放不下时左右滑动
    <ViewFrame>
      <RaciTable />
    </ViewFrame>
  );
}

function RaciTable() {
  const { data } = useTaskData();
  const { status } = useSelection();
  const { project, scopeOf } = useCurrentGroup();
  const scope = scopeOf(project?.id ?? null);
  const members = scope?.members ?? [];
  const contacts = scope?.contacts ?? [];
  const { open } = usePanels();
  const tasks = useVisibleTasks();

  if (!data) return null;
  if (tasks.length === 0) {
    return <p className="muted empty">没有{status === 'all' ? '' : STATUS_LABELS[status]}任务</p>;
  }

  const people = [
    ...members.map((m) => ({ key: `u:${m.userId}`, name: m.nickname, userId: m.userId })),
    ...contacts.map((c) => ({ key: `c:${c.id}`, name: c.name, contactId: c.id })),
  ];

  const letters = (taskId: string, person: (typeof people)[number]) => {
    const assignments = data.assignmentsByTask.get(taskId) ?? [];
    return RACI_ROLES.filter((role) =>
      assignments.some(
        (a) =>
          a.role === role &&
          ('userId' in person ? a.userId === person.userId : a.contactId === person.contactId),
      ),
    ).join(' ');
  };

  return (
    <div className="raci-scroll">
      <table className="raci-table" aria-label="责任分配矩阵">
        <thead>
          <tr>
            <th scope="col" className="raci-task-head" />
            {people.map((person) => (
              <th key={person.key} scope="col">
                <PersonName name={person.name} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id}>
              <th scope="row" className="raci-task">
                <button
                  type="button"
                  className="raci-task-title"
                  onClick={() => open({ kind: 'edit', taskId: task.id, surface: 'floating' })}
                >
                  {task.title}
                </button>
              </th>
              {people.map((person) => (
                <td key={person.key}>{letters(task.id, person)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
