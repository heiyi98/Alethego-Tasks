'use client';

import type { TaskView } from '@alethego/core';
import type { ComponentType } from 'react';

import { ListView } from './list-view';
import { RaciMatrixView } from './raci-matrix-view';

/**
 * 任务的各种看法。它们都从同一份数据（TaskDataProvider + useVisibleTasks）取任务，各自只负责怎么画；
 * 哪种容器能用哪些看法由 core 的 CONTAINER_FEATURES 决定。以后加甘特图：在 core 的 TaskView 里加一项、
 * 在这里登记一个组件，再在 CONTAINER_FEATURES 里给需要的容器打开，其他看法和数据层都不用动。
 * 时间管理矩阵有自己的地址（/matrix），所以不在首页这里渲染。
 */
export const TASK_VIEWS: Record<Exclude<TaskView, 'matrix'>, ComponentType> = {
  list: ListView,
  raci: RaciMatrixView,
};
