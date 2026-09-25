import { describe, expect, it } from 'vitest';

import { normalizeTaskTitle } from './task-title';

describe('normalizeTaskTitle', () => {
  it('去除首尾空白', () => {
    expect(normalizeTaskTitle('  买牛奶 \n')).toBe('买牛奶');
  });

  it('空白标题返回 null', () => {
    expect(normalizeTaskTitle('')).toBeNull();
    expect(normalizeTaskTitle(' \t ')).toBeNull();
  });
});
