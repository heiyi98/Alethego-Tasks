'use client';

import { buildTaskList, type Task } from '@alethego/core';
import { useEffect, useMemo, useRef } from 'react';

import { useCurrentUser } from '@/auth';
import { usePanels } from '@/components/panel-provider';
import { relatedGroupTaskPredicate } from '@/lib/related';
import { useSelection } from '@/components/selection';
import { useTaskData } from '@/components/task-data-provider';

/**
 * 清单、责任分配矩阵等看法共用的任务来源：侧边栏所选的那一项（总览 / 今日 / 收藏 / 分类 / 组 / 项目）∩ 状态，
 * 按截止时间排序。各看法只负责怎么画。
 * 正在编辑的任务即使改完后不再符合筛选（例如标记完成），也先留在原位，收起面板后再消失。
 */
export function useVisibleTasks(): Task[] {
  const { data, now, timeZone } = useTaskData();
  const { scope, status, categoryIds, groupId, projectId } = useSelection();
  const { active } = usePanels();
  const user = useCurrentUser();

  const visible = useMemo(
    () =>
      data
        ? buildTaskList(
            {
              tasks: data.tasks,
              categoryIdsByTask: data.categoryIdsByTask,
              occurrencesByTask: data.occurrencesByTask,
            },
            {
              scope,
              status,
              categoryIds,
              groupId,
              projectId,
              isRelatedGroupTask: relatedGroupTaskPredicate(data, user.id),
            },
            { now, timeZone },
          )
        : [],
    [data, scope, status, categoryIds, groupId, projectId, now, timeZone, user.id],
  );

  const openTaskId = active?.kind === 'edit' && active.surface === 'inline' ? active.taskId : null;
  const lastOrder = useRef<string[]>([]);
  const shown = useMemo(() => {
    const list = [...visible];
    const openTask = openTaskId ? data?.tasks.find((t) => t.id === openTaskId) : undefined;
    if (openTask && !list.some((t) => t.id === openTask.id)) {
      const index = lastOrder.current.indexOf(openTask.id);
      list.splice(index < 0 ? list.length : Math.min(index, list.length), 0, openTask);
    }
    return list;
  }, [visible, openTaskId, data]);
  useEffect(() => {
    lastOrder.current = shown.map((t) => t.id);
  }, [shown]);

  return shown;
}
