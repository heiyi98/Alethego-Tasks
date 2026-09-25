/**
 * 循环任务实例记录的状态：
 * - pending：实例已出现、尚未被判定
 * - completed：用户标记完成
 * - missed：下一次实例出现时仍未完成，由系统自动归档；用户可事后手动修改
 */
export type OccurrenceStatus = 'pending' | 'completed' | 'missed';

/** 循环任务的一次实例记录，与 recurrence_occurrences 表对应。 */
export interface RecurrenceOccurrence {
  id: string;
  taskId: string;
  /** 这次实例对应的时间点（UTC） */
  occurrenceDate: Date;
  status: OccurrenceStatus;
  completedAt: Date | null;
  createdAt: Date;
}
