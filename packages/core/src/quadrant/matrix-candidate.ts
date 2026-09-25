import type { ImportanceLevel } from '../domain/importance';
import type { Urgency } from '../urgency/urgency-calculator';

/**
 * 进入矩阵判定的「一个代表」。
 *
 * 这是 QuadrantClassifier 唯一接受的输入形状：它背后可能是普通任务本身，
 * 也可能是循环任务当前的代表实例（或未来的任何任务形态），矩阵对此不感知。
 */
export interface MatrixCandidate {
  importanceLevel: ImportanceLevel;
  urgency: Urgency;
}
