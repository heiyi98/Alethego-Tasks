import { describe, expect, it } from 'vitest';

import {
  deadlineFromForm,
  emptyTaskForm,
  isDraftDirty,
  newTaskFromForm,
  samePeople,
  taskPatchFromForms,
  validateTaskForm,
  type TaskFormValue,
} from './task-form';

const TZ = 'Asia/Shanghai';

const form = (patch: Partial<TaskFormValue> = {}): TaskFormValue => ({
  ...emptyTaskForm(),
  title: '任务',
  ...patch,
});

const daily = {
  enabled: true,
  spec: null,
  customRule: 'FREQ=DAILY',
  dtstart: '2026-10-01T09:00',
};

describe('截止日期 + 可选时刻', () => {
  it('没选时刻 → 该日本地日终点（过完当天才算已错过）', () => {
    expect(deadlineFromForm('2026-10-01', '', TZ)?.toISOString()).toBe('2026-10-01T15:59:59.999Z');
  });

  it('选了时刻 → 那一刻', () => {
    expect(deadlineFromForm('2026-10-01', '14:30', TZ)?.toISOString()).toBe(
      '2026-10-01T06:30:00.000Z',
    );
  });

  it('没有日期 → 没有截止时间（时刻单独无效）', () => {
    expect(deadlineFromForm('', '', TZ)).toBeNull();
    expect(deadlineFromForm('', '14:30', TZ)).toBeNull();
  });
});

describe('新建', () => {
  it('带时刻与标星', () => {
    const task = newTaskFromForm(
      form({ deadline: '2026-10-01', deadlineTime: '09:00', isStarred: true }),
      TZ,
    );
    expect(task.deadlineAt).toEqual(new Date('2026-10-01T01:00:00Z'));
    expect(task.isStarred).toBe(true);
  });

  it('标题去空白，截止日期取日终点，默认重要性 0', () => {
    const task = newTaskFromForm(form({ title: '  交房租 ', deadline: '2026-10-01' }), TZ);
    expect(task).toMatchObject({
      title: '交房租',
      importanceLevel: 0,
      deadlineAt: new Date('2026-10-01T15:59:59.999Z'),
      recurrenceRule: null,
      isStarred: false,
    });
  });

  it('打开循环时忽略截止日期，写入规则与起始时间', () => {
    const task = newTaskFromForm(form({ deadline: '2026-10-01', recurrence: daily }), TZ);
    expect(task.deadlineAt).toBeNull();
    expect(task.recurrenceRule).toBe('FREQ=DAILY');
    expect(task.recurrenceDtstart).toEqual(new Date('2026-10-01T01:00:00Z'));
  });

  it('草稿是否填写了内容：页面默认值（分类、收藏里的标星）不算，改了才算', () => {
    const defaults = { categoryIds: ['work'], isStarred: false };
    const empty = { ...emptyTaskForm(['work']) };
    expect(isDraftDirty(empty, defaults)).toBe(false);
    expect(isDraftDirty({ ...empty, categoryIds: [] }, defaults)).toBe(true);
    expect(isDraftDirty({ ...empty, importanceLevel: 2 }, defaults)).toBe(true);
    expect(isDraftDirty({ ...empty, title: '  ' }, defaults)).toBe(false);
    expect(
      isDraftDirty({ ...empty, people: [{ key: 'a', name: '', relation: '' }] }, defaults),
    ).toBe(false);
    // 在"收藏"里：默认标星不算内容，取消标星才算
    const starredDefaults = { ...defaults, isStarred: true };
    expect(isDraftDirty({ ...empty, isStarred: true }, starredDefaults)).toBe(false);
    expect(isDraftDirty(empty, starredDefaults)).toBe(true);
  });
});

describe('校验', () => {
  it('空标题与缺少姓名的人物', () => {
    const errors = validateTaskForm(
      form({ title: '  ', people: [{ key: 'a', name: '', relation: '同事' }] }),
    );
    expect(errors).toEqual({ title: '标题不能为空', people: '第 1 个人物缺少姓名' });
  });

  it('只有空行的人物不算错误', () => {
    expect(validateTaskForm(form({ people: [{ key: 'a', name: '', relation: '' }] }))).toEqual({});
  });
});

describe('编辑自动保存的差异', () => {
  const saved = form({ deadline: '2026-10-01', deadlineTime: '09:30', importanceLevel: 2 });

  it('没有改动时为空', () => {
    expect(taskPatchFromForms(saved, saved, TZ)).toEqual({});
  });

  it('只包含改动的字段', () => {
    const patch = taskPatchFromForms({ ...saved, importanceLevel: 5 }, saved, TZ);
    expect(patch).toEqual({ importanceLevel: 5 });
    expect(taskPatchFromForms({ ...saved, isStarred: true }, saved, TZ)).toEqual({
      isStarred: true,
    });
  });

  it('改日期保留时刻；清除时刻 → 日终点；清空日期 → null', () => {
    expect(taskPatchFromForms({ ...saved, deadline: '2026-10-03' }, saved, TZ).deadlineAt).toEqual(
      new Date('2026-10-03T01:30:00Z'),
    );
    expect(taskPatchFromForms({ ...saved, deadlineTime: '' }, saved, TZ).deadlineAt).toEqual(
      new Date('2026-10-01T15:59:59.999Z'),
    );
    expect(taskPatchFromForms({ ...saved, deadline: '' }, saved, TZ).deadlineAt).toBeNull();
  });

  it('空标题不写入（界面提示错误）', () => {
    expect(taskPatchFromForms({ ...saved, title: '  ' }, saved, TZ)).toEqual({});
  });

  it('循环任务不写截止时间与完成状态', () => {
    const recurringSaved = { ...saved, recurrence: daily };
    const patch = taskPatchFromForms(
      { ...recurringSaved, deadline: '2026-12-01', completed: true },
      recurringSaved,
      TZ,
    );
    expect(patch).toEqual({});
  });

  it('标记完成写入完成时间，取消写 null', () => {
    expect(taskPatchFromForms({ ...saved, completed: true }, saved, TZ).completedAt).toBeInstanceOf(
      Date,
    );
    const done = { ...saved, completed: true };
    expect(taskPatchFromForms({ ...done, completed: false }, done, TZ).completedAt).toBeNull();
  });

  it('人物比较忽略空行与首尾空白', () => {
    const a = [{ key: '1', id: 'p1', name: '张三', relation: '客户' }];
    const b = [
      { key: '1', id: 'p1', name: ' 张三 ', relation: '客户' },
      { key: '2', name: '', relation: '' },
    ];
    expect(samePeople(a, b)).toBe(true);
    expect(samePeople(a, [{ ...a[0]!, relation: '甲方' }])).toBe(false);
  });
});
