import { describe, expect, it } from 'vitest';

import type { ImportanceLevel } from '../domain/importance';
import type { Urgency } from '../urgency/urgency-calculator';
import { classifyQuadrant, placeOnMatrix } from './quadrant-classifier';

const noDeadline: Urgency = { kind: 'no_deadline' };
const day = (dayNumber: number): Urgency => ({ kind: 'scheduled', dayNumber });
const tomorrow = day(2);
const inAMonth = day(30);
const far: Urgency = { kind: 'far', dayNumber: 500, extendedTierDays: 730 };
const overdue = (overdueDays: number): Urgency => ({ kind: 'overdue', overdueDays });

const candidate = (importanceLevel: ImportanceLevel, urgency: Urgency) => ({
  importanceLevel,
  urgency,
});

describe('classifyQuadrant', () => {
  it('重要性 3-5 算重要，0-2 算不重要（与模式无关）', () => {
    for (const mode of ['short', 'long'] as const) {
      expect(classifyQuadrant(candidate(2, tomorrow), mode)).toBe('not_important_urgent');
      expect(classifyQuadrant(candidate(3, tomorrow), mode)).toBe('important_urgent');
      expect(classifyQuadrant(candidate(5, inAMonth), mode)).toBe('important_not_urgent');
    }
  });

  it('"不重要且不紧急"是合法象限', () => {
    expect(classifyQuadrant(candidate(1, inAMonth), 'long')).toBe('not_important_not_urgent');
  });

  it('重要性为 0 但有截止时间 → 不重要一侧', () => {
    expect(classifyQuadrant(candidate(0, tomorrow), 'short')).toBe('not_important_urgent');
  });

  it('有重要性但无截止时间 → 不紧急一侧', () => {
    expect(classifyQuadrant(candidate(4, noDeadline), 'short')).toBe('important_not_urgent');
    expect(classifyQuadrant(candidate(4, noDeadline), 'long')).toBe('important_not_urgent');
  });

  it('重要性为 0 且无截止时间 → 无象限', () => {
    expect(classifyQuadrant(candidate(0, noDeadline), 'short')).toBeNull();
  });

  it('短期：N ≤ 3 紧急，N = 4 不紧急', () => {
    expect(classifyQuadrant(candidate(4, day(3)), 'short')).toBe('important_urgent');
    expect(classifyQuadrant(candidate(4, day(4)), 'short')).toBe('important_not_urgent');
  });

  it('长期：N ≤ 14 紧急，N = 15 不紧急', () => {
    expect(classifyQuadrant(candidate(4, day(14)), 'long')).toBe('important_urgent');
    expect(classifyQuadrant(candidate(4, day(15)), 'long')).toBe('important_not_urgent');
  });

  it('同一个任务在两种模式下可以落在不同象限', () => {
    expect(classifyQuadrant(candidate(4, day(10)), 'short')).toBe('important_not_urgent');
    expect(classifyQuadrant(candidate(4, day(10)), 'long')).toBe('important_urgent');
  });

  it('逾期算紧急', () => {
    expect(classifyQuadrant(candidate(4, overdue(2)), 'short')).toBe('important_urgent');
    expect(classifyQuadrant(candidate(4, overdue(2)), 'long')).toBe('important_urgent');
  });
});

describe('placeOnMatrix', () => {
  it('未处理的任务不进入矩阵', () => {
    expect(placeOnMatrix(candidate(0, noDeadline), 'short')).toEqual({
      visible: false,
      reason: 'unprocessed',
    });
  });

  it('远期任务即使有重要性也不进入矩阵', () => {
    expect(placeOnMatrix(candidate(5, far), 'long')).toEqual({
      visible: false,
      reason: 'far_future',
    });
  });

  it('按模式落格：column 从左到右 0..5', () => {
    expect(placeOnMatrix(candidate(1, day(1)), 'short')).toMatchObject({
      slot: { kind: 'cell', column: 5 },
    });
    expect(placeOnMatrix(candidate(1, day(14)), 'short')).toMatchObject({
      slot: { kind: 'cell', column: 0 },
    });
    expect(placeOnMatrix(candidate(1, inAMonth), 'long')).toEqual({
      visible: true,
      quadrant: 'not_important_not_urgent',
      overdueDays: null,
      slot: { kind: 'cell', column: 2 },
    });
  });

  it('超出当前模式范围：进入四象限清单，但图上不画', () => {
    expect(placeOnMatrix(candidate(1, inAMonth), 'short')).toEqual({
      visible: true,
      quadrant: 'not_important_not_urgent',
      overdueDays: null,
      slot: null,
    });
    expect(placeOnMatrix(candidate(1, day(181)), 'long')).toMatchObject({
      visible: true,
      slot: null,
    });
  });

  it('没设截止日期但设了重要性：两种模式都在最左边缘', () => {
    for (const mode of ['short', 'long'] as const) {
      expect(placeOnMatrix(candidate(3, noDeadline), mode)).toMatchObject({
        visible: true,
        slot: { kind: 'no_deadline' },
      });
    }
  });

  it('逾期 0 / 1 / 2 天在逾期区（两种模式）', () => {
    for (const mode of ['short', 'long'] as const) {
      for (const days of [0, 1, 2]) {
        expect(placeOnMatrix(candidate(0, overdue(days)), mode)).toEqual({
          visible: true,
          quadrant: 'not_important_urgent',
          overdueDays: days,
          slot: { kind: 'overdue', overdueDays: days },
        });
      }
    }
  });

  it('逾期满 3 天退出矩阵', () => {
    expect(placeOnMatrix(candidate(5, overdue(3)), 'short')).toEqual({
      visible: false,
      reason: 'overdue_expired',
    });
  });
});
