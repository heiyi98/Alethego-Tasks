import type { ImportanceLevel } from './importance';

/**
 * 任务实体，与 tasks 表一一对应（字段名转为 camelCase）。
 *
 * 循环不是独立的任务类型：recurrenceRule 非空即为循环任务（"开关"打开），为空即为普通任务。
 * 状态（待办/已错过/已完成）是派生值，见 task-status.ts。
 */
export interface Task {
  id: string;
  /** 个人任务：所有者；组任务：创建者 */
  ownerId: string;
  /**
   * 所属的组；null = 个人任务。一条任务只属于一个容器（个人或某一个组），创建后不能移动。
   * 组任务不使用重要性、分类、收藏，不进总览和矩阵。
   */
  groupId: string | null;
  title: string;
  description: string;
  /** 截止时间（UTC），null 表示无截止时间 */
  deadlineAt: Date | null;
  importanceLevel: ImportanceLevel;
  /** RFC 5545 RRULE 字符串，如 "FREQ=WEEKLY;BYDAY=MO,WE,FR" */
  recurrenceRule: string | null;
  recurrenceDtstart: Date | null;
  completedAt: Date | null;
  /**
   * 已确认的时间。个人任务、合作组任务完成即确认（与 completedAt 相同）；
   * 管理组任务由 A 确认：completedAt 有值而它为 null = 待确认。
   */
  confirmedAt: Date | null;
  /** 标星：只是书签，不影响矩阵位置、排序或任何其他规则 */
  isStarred: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** 软删除时间；非空即已删除，只在列表/矩阵中隐藏，数据保留 */
  deletedAt: Date | null;
}
