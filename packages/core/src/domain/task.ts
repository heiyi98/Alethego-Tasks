import type { ImportanceLevel } from './importance';

/**
 * 任务实体，与 tasks 表一一对应（字段名转为 camelCase）。
 *
 * 循环不是独立的任务类型：recurrenceRule 非空即为循环任务（"开关"打开），为空即为普通任务。
 * 状态（待办/已错过/已完成）是派生值，见 task-status.ts。
 */
export interface Task {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  /** 截止时间（UTC），null 表示无截止时间 */
  deadlineAt: Date | null;
  importanceLevel: ImportanceLevel;
  /** RFC 5545 RRULE 字符串，如 "FREQ=WEEKLY;BYDAY=MO,WE,FR" */
  recurrenceRule: string | null;
  recurrenceDtstart: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
