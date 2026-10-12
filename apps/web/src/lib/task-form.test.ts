import { describe, expect, it } from 'vitest';

import { defaultRecurrenceForm } from './recurrence-form';
import {
  emptyTaskForm,
  isDraftDirty,
  newTaskFromForm,
  samePeople,
  taskPatchFromForms,
  validateTaskForm,
  type TaskFormValue,
} from './task-form';

const form = (patch: Partial<TaskFormValue> = {}): TaskFormValue => ({
  ...emptyTaskForm(),
  title: '任务',
  ...patch,
});

/** 每天，从 10 月 1 日起 */
const daily = { ...defaultRecurrenceForm('2026-10-01', true), period: 'day' as const };

describe('新建', () => {
  it('截止日期只到哪一天；标星', () => {
    const task = newTaskFromForm(form({ deadline: '2026-10-01', isStarred: true }));
    expect(task.deadlineOn).toBe('2026-10-01');
    expect(task.isStarred).toBe(true);
  });

  it('标题去空白，默认重要性 0（随意）', () => {
    expect(newTaskFromForm(form({ title: '  交房租 ', deadline: '2026-10-01' }))).toMatchObject({
      title: '交房租',
      importanceLevel: 0,
      deadlineOn: '2026-10-01',
      recurrenceRule: null,
      isStarred: false,
    });
  });

  it('组任务：写入项目和组，带重要性，不带收藏', () => {
    const task = newTaskFromForm(form({ importanceLevel: 3, isStarred: true }), {
      groupId: 'g1',
      projectId: 'p1',
    });
    expect(task).toMatchObject({
      groupId: 'g1',
      projectId: 'p1',
      importanceLevel: 3,
      isStarred: false,
    });
    expect(newTaskFromForm(form({})).projectId).toBeUndefined();
  });

  it('打开循环：第二行的日期就是开始日期，不写截止日期', () => {
    const task = newTaskFromForm(form({ deadline: '2026-10-05', recurrence: daily }));
    expect(task.deadlineOn).toBeNull();
    expect(task.recurrenceRule).toBe('FREQ=DAILY');
    expect(task.recurrenceStartOn).toBe('2026-10-05');
  });

  it('草稿是否填写了内容：页面默认值（分类、收藏里的标星）不算，改了才算', () => {
    const defaults = { categoryIds: ['work'], isStarred: false };
    const empty = { ...emptyTaskForm(['work']) };
    expect(isDraftDirty(empty, defaults)).toBe(false);
    expect(isDraftDirty({ ...empty, categoryIds: [] }, defaults)).toBe(true);
    expect(isDraftDirty({ ...empty, importanceLevel: 2 }, defaults)).toBe(true);
    expect(isDraftDirty({ ...empty, title: '  ' }, defaults)).toBe(false);
    expect(isDraftDirty({ ...empty, people: [{ key: 'a', name: '', note: '' }] }, defaults)).toBe(
      false,
    );
    const starredDefaults = { ...defaults, isStarred: true };
    expect(isDraftDirty({ ...empty, isStarred: true }, starredDefaults)).toBe(false);
    expect(isDraftDirty(empty, starredDefaults)).toBe(true);
  });
});

describe('校验', () => {
  it('空标题与缺少姓名的人物（名字 + 备注）', () => {
    const errors = validateTaskForm(
      form({ title: '  ', people: [{ key: 'a', name: '', note: '同事' }] }),
    );
    expect(errors).toEqual({ title: '标题不能为空', people: '第 1 个人物缺少姓名' });
  });

  it('只有空行的人物不算错误', () => {
    expect(validateTaskForm(form({ people: [{ key: 'a', name: '', note: '' }] }))).toEqual({});
  });

  it('循环规则必须选了日子；循环任务必须有开始日期', () => {
    const weekly = { ...defaultRecurrenceForm('2026-10-01', true), weekdays: [] };
    expect(validateTaskForm(form({ deadline: '2026-10-01', recurrence: weekly })).recurrence).toBe(
      '请至少选择一个星期几',
    );
    expect(validateTaskForm(form({ deadline: '', recurrence: daily })).recurrence).toBe(
      '请选择开始日期',
    );
  });
});

describe('编辑时保存的差异', () => {
  const saved = form({ deadline: '2026-10-01', importanceLevel: 2 });

  it('没有改动时为空；只包含改动的字段', () => {
    expect(taskPatchFromForms(saved, saved)).toEqual({});
    expect(taskPatchFromForms({ ...saved, importanceLevel: 3 }, saved)).toEqual({
      importanceLevel: 3,
    });
    expect(taskPatchFromForms({ ...saved, isStarred: true }, saved)).toEqual({ isStarred: true });
  });

  it('改截止日期；清空 → null', () => {
    expect(taskPatchFromForms({ ...saved, deadline: '2026-10-03' }, saved).deadlineOn).toBe(
      '2026-10-03',
    );
    expect(taskPatchFromForms({ ...saved, deadline: '' }, saved).deadlineOn).toBeNull();
  });

  it('空标题不写入（界面提示错误）', () => {
    expect(taskPatchFromForms({ ...saved, title: '  ' }, saved)).toEqual({});
  });

  it('循环任务：改第二行的日期 = 换开始日期（从这天起重新排）；不写截止日期与完成状态', () => {
    const recurringSaved = { ...saved, recurrence: daily };
    expect(
      taskPatchFromForms(
        { ...recurringSaved, deadline: '2026-12-01', completed: true },
        recurringSaved,
      ),
    ).toEqual({ recurrenceStartOn: '2026-12-01' });
  });

  it('打开循环：写规则和开始日期；关掉循环：写回截止日期', () => {
    expect(taskPatchFromForms({ ...saved, recurrence: daily }, saved)).toEqual({
      recurrenceRule: 'FREQ=DAILY',
      recurrenceStartOn: '2026-10-01',
    });
    const recurringSaved = { ...saved, recurrence: daily };
    expect(
      taskPatchFromForms(
        { ...recurringSaved, recurrence: { ...daily, enabled: false } },
        recurringSaved,
      ),
    ).toEqual({ recurrenceRule: null, deadlineOn: '2026-10-01' });
  });

  it('只换了没选中的标尺（例如月里的日子）不算改动', () => {
    const recurringSaved = { ...saved, recurrence: daily };
    expect(
      taskPatchFromForms(
        { ...recurringSaved, recurrence: { ...daily, monthDays: [1, 2, 3] } },
        recurringSaved,
      ),
    ).toEqual({});
  });

  it('标记完成写入完成时间，取消写 null', () => {
    expect(taskPatchFromForms({ ...saved, completed: true }, saved).completedAt).toBeInstanceOf(
      Date,
    );
    const done = { ...saved, completed: true };
    expect(taskPatchFromForms({ ...done, completed: false }, done).completedAt).toBeNull();
  });

  it('人物比较忽略空行与首尾空白', () => {
    const a = [{ key: '1', id: 'p1', name: '张三', note: '客户' }];
    const b = [
      { key: '1', id: 'p1', name: ' 张三 ', note: '客户' },
      { key: '2', name: '', note: '' },
    ];
    expect(samePeople(a, b)).toBe(true);
    expect(samePeople(a, [{ ...a[0]!, note: '甲方' }])).toBe(false);
  });
});
