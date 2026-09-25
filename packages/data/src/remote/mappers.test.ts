import { describe, expect, it } from 'vitest';

import { DataError } from '../errors';
import { taskFromRow, taskPatchToUpdate, taskToInsert } from './mappers';

const row = {
  id: 't1',
  owner_id: 'u1',
  title: '写周报',
  description: '',
  deadline_at: '2026-09-26T10:00:00+00:00',
  importance_level: 3,
  recurrence_rule: null,
  recurrence_dtstart: null,
  completed_at: null,
  created_at: '2026-09-25T00:00:00+00:00',
  updated_at: '2026-09-25T00:00:00+00:00',
};

describe('task mappers', () => {
  it('行 → 领域对象', () => {
    expect(taskFromRow(row)).toMatchObject({
      id: 't1',
      ownerId: 'u1',
      deadlineAt: new Date('2026-09-26T10:00:00Z'),
      importanceLevel: 3,
      completedAt: null,
    });
  });

  it('非法重要性抛错', () => {
    expect(() => taskFromRow({ ...row, importance_level: 6 })).toThrow(DataError);
  });

  it('新建任务填默认值，不包含 owner_id（由数据库按 auth.uid() 填充）', () => {
    expect(taskToInsert({ title: 'x' })).toEqual({
      title: 'x',
      description: '',
      deadline_at: null,
      importance_level: 0,
      recurrence_rule: null,
      recurrence_dtstart: null,
    });
  });

  it('补丁只包含传入的字段，null 会被显式写入', () => {
    expect(taskPatchToUpdate({ deadlineAt: null, importanceLevel: 5 })).toEqual({
      deadline_at: null,
      importance_level: 5,
    });
  });
});
