import { isRelatedGroupTask, type Task } from '@alethego/core';

import type { TaskListData } from '@/hooks/use-task-list-data';

/**
 * "和我有关的组任务"（今日、时间管理矩阵用）：开了任务分配的项目里我是执行人的任务；
 * 没开任务分配的项目里，我所在项目的全部任务。
 */
export function relatedGroupTaskPredicate(
  data: Pick<TaskListData, 'projects' | 'assignmentsByTask'>,
  myUserId: string,
): (task: Pick<Task, 'id' | 'projectId'>) => boolean {
  const withAssignment = new Set(
    data.projects.filter((p) => p.tools.includes('assignment')).map((p) => p.id),
  );
  return (task) =>
    isRelatedGroupTask(task, {
      myUserId,
      projectHasAssignment: (id) => withAssignment.has(id),
      assignmentsOf: (id) => data.assignmentsByTask.get(id) ?? [],
    });
}
