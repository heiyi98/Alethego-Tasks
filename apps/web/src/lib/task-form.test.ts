import { describe, expect, it } from 'vitest';

import {
  deadlineFromDateValue,
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

describe('截止日期只精确到天', () => {
  it('日期 → 该日本地日终点', () => {
    expect(deadlineFromDateValue('2026-10-01', TZ)?.toISOString()).toBe('2026-10-01T15:59:59.999Z');
  });

  it('空字符串 → 没有截止日期', () => {
    expect(deadlineFromDateValue('', TZ)).toBeNull();
  });
});

describe('新建', () => {
  it('标题去空白，截止日期取日终点，默认重要性 0', () => {
    const task = newTaskFromForm(form({ title: '  交房租 ', deadline: '2026-10-01' }), TZ);
    expect(task).toMatchObject({
      title: '交房租',
      importanceLevel: 0,
      deadlineAt: new Date('2026-10-01T15:59:59.999Z'),
      recurrenceRule: null,
    });
  });

  it('打开循环时忽略截止日期，写入规则与起始时间', () => {
    const task = newTaskFromForm(form({ deadline: '2026-10-01', recurrence: daily }), TZ);
    expect(task.deadlineAt).toBeNull();
    expect(task.recurrenceRule).toBe('FREQ=DAILY');
    expect(task.recurrenceDtstart).toEqual(new Date('2026-10-01T01:00:00Z'));
  });

  it('草稿是否填写了内容：默认分类不算，改了分类才算', () => {
    const empty = { ...emptyTaskForm(['work']) };
    expect(isDraftDirty(empty, ['work'])).toBe(false);
    expect(isDraftDirty({ ...empty, categoryIds: [] }, ['work'])).toBe(true);
    expect(isDraftDirty({ ...empty, importanceLevel: 2 }, ['work'])).toBe(true);
    expect(isDraftDirty({ ...empty, title: '  ' }, ['work'])).toBe(false);
    expect(
      isDraftDirty({ ...empty, people: [{ key: 'a', name: '', relation: '' }] }, ['work']),
    ).toBe(false);
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
  const original = new Date('2026-10-01T01:30:00Z'); // 本地 09:30，以前设置过具体时刻
  const saved = form({ deadline: '2026-10-01', importanceLevel: 2 });

  it('没有改动时为空', () => {
    expect(taskPatchFromForms(saved, saved, TZ, original)).toEqual({});
  });

  it('只包含改动的字段；日期没变时保留原来的时刻', () => {
    const patch = taskPatchFromForms({ ...saved, importanceLevel: 5 }, saved, TZ, original);
    expect(patch).toEqual({ importanceLevel: 5 });
  });

  it('改日期 → 新日期的日终点；清空 → null', () => {
    expect(
      taskPatchFromForms({ ...saved, deadline: '2026-10-03' }, saved, TZ, original).deadlineAt,
    ).toEqual(new Date('2026-10-03T15:59:59.999Z'));
    expect(
      taskPatchFromForms({ ...saved, deadline: '' }, saved, TZ, original).deadlineAt,
    ).toBeNull();
  });

  it('空标题不写入（界面提示错误）', () => {
    expect(taskPatchFromForms({ ...saved, title: '  ' }, saved, TZ, original)).toEqual({});
  });

  it('循环任务不写截止时间与完成状态', () => {
    const recurringSaved = { ...saved, recurrence: daily };
    const patch = taskPatchFromForms(
      { ...recurringSaved, deadline: '2026-12-01', completed: true },
      recurringSaved,
      TZ,
      null,
    );
    expect(patch).toEqual({});
  });

  it('标记完成写入完成时间，取消写 null', () => {
    expect(
      taskPatchFromForms({ ...saved, completed: true }, saved, TZ, original).completedAt,
    ).toBeInstanceOf(Date);
    const done = { ...saved, completed: true };
    expect(
      taskPatchFromForms({ ...done, completed: false }, done, TZ, original).completedAt,
    ).toBeNull();
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
