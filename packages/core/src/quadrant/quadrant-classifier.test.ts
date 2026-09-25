import { describe, expect, it } from 'vitest';

import type { ImportanceLevel } from '../domain/importance';
import type { Urgency } from '../urgency/urgency-calculator';
import { classifyQuadrant, placeOnMatrix } from './quadrant-classifier';

const noDeadline: Urgency = { kind: 'no_deadline', tierIndex: 13 };
const tomorrow: Urgency = { kind: 'scheduled', daysRemaining: 1, tierIndex: 1, tierDays: 1 };
const inAMonth: Urgency = { kind: 'scheduled', daysRemaining: 30, tierIndex: 8, tierDays: 34 };
const far: Urgency = { kind: 'far', daysRemaining: 500, extendedTierDays: 610 };
const overdue = (overdueDays: number): Urgency => ({ kind: 'overdue', overdueDays });

const candidate = (importanceLevel: ImportanceLevel, urgency: Urgency) => ({
  importanceLevel,
  urgency,
});

describe('classifyQuadrant', () => {
  it('重要性 3-5 算重要，0-2 算不重要', () => {
    expect(classifyQuadrant(candidate(2, tomorrow))).toBe('not_important_urgent');
    expect(classifyQuadrant(candidate(3, tomorrow))).toBe('important_urgent');
    expect(classifyQuadrant(candidate(5, inAMonth))).toBe('important_not_urgent');
  });

  it('"不重要且不紧急"是合法象限', () => {
    expect(classifyQuadrant(candidate(1, inAMonth))).toBe('not_important_not_urgent');
  });

  it('重要性为 0 但有截止时间 → 不重要一侧', () => {
    expect(classifyQuadrant(candidate(0, tomorrow))).toBe('not_important_urgent');
  });

  it('有重要性但无截止时间 → 不紧急一侧', () => {
    expect(classifyQuadrant(candidate(4, noDeadline))).toBe('important_not_urgent');
  });

  it('重要性为 0 且无截止时间 → 无象限', () => {
    expect(classifyQuadrant(candidate(0, noDeadline))).toBeNull();
  });

  it('逾期算紧急', () => {
    expect(classifyQuadrant(candidate(4, overdue(2)))).toBe('important_urgent');
  });
});

describe('placeOnMatrix', () => {
  it('未处理的任务不进入矩阵', () => {
    expect(placeOnMatrix(candidate(0, noDeadline))).toEqual({
      visible: false,
      reason: 'unprocessed',
    });
  });

  it('远期任务即使有重要性也不进入矩阵', () => {
    expect(placeOnMatrix(candidate(5, far))).toEqual({ visible: false, reason: 'far_future' });
  });

  it('普通任务正常显示', () => {
    expect(placeOnMatrix(candidate(1, inAMonth))).toEqual({
      visible: true,
      quadrant: 'not_important_not_urgent',
      overdueDays: null,
    });
  });

  it('逾期 3 天内贴边显示并标注逾期天数', () => {
    expect(placeOnMatrix(candidate(0, overdue(3)))).toEqual({
      visible: true,
      quadrant: 'not_important_urgent',
      overdueDays: 3,
    });
  });

  it('逾期超过 3 天退出矩阵', () => {
    expect(placeOnMatrix(candidate(5, overdue(4)))).toEqual({
      visible: false,
      reason: 'overdue_expired',
    });
  });
});
