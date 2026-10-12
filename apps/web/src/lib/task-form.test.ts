import { describe, expect, it } from 'vitest';

import {
  defaultRecurrenceForm,
  isRecurring,
  recurrenceFormFromRule,
  recurrencePatch,
  sameRecurrence,
  specFromForm,
} from './recurrence-form';
import {
  emptyTaskForm,
  isDraftDirty,
  newTaskFromForm,
  samePeople,
  taskChangesFromForms,
  validateTaskForm,
  type TaskFormValue,
} from './task-form';

const form = (patch: Partial<TaskFormValue> = {}): TaskFormValue => ({
  ...emptyTaskForm(),
  title: '任务',
  ...patch,
});

/** 每天 */
const daily = { ...defaultRecurrenceForm(true), period: 'day' as const };
/** 每周一 */
const mondays = {
  ...defaultRecurrenceForm(true),
  period: 'week' as const,
  weekdays: ['MO' as const],
};

describe('重复规则的表单', () => {
  it('打开循环后不默认选中任何模式；选了模式后选项全部空着，间隔默认 1', () => {
    const opened = defaultRecurrenceForm(true);
    expect(opened.period).toBeNull();
    expect(opened.interval).toBe(1);
    expect(opened.weekdays).toEqual([]);
    expect(opened.monthBy).toBeNull();
    expect(opened.monthDays).toEqual([]);
    expect(opened.monthRows).toEqual([{ ordinal: null, weekdays: [] }]);
    expect(opened.yearBy).toBeNull();
    expect(opened.yearDays).toEqual({});
    expect(opened.yearMonthRows).toEqual([{ month: null, ordinal: null, weekdays: [] }]);
    expect(opened.yearWeekRows).toEqual([{ week: null, weekdays: [] }]);
  });

  it('什么都没选 = 没有开启循环（没选模式、选了模式但一个位置都没选、条件行没选完）', () => {
    const opened = defaultRecurrenceForm(true);
    expect(specFromForm(opened)).toBeNull();
    expect(specFromForm({ ...opened, period: 'week' })).toBeNull();
    expect(specFromForm({ ...opened, period: 'month' })).toBeNull();
    expect(specFromForm({ ...opened, period: 'month', monthBy: 'day' })).toBeNull();
    expect(
      specFromForm({
        ...opened,
        period: 'month',
        monthBy: 'weekday',
        monthRows: [{ ordinal: 2, weekdays: [] }],
      }),
    ).toBeNull();
    expect(
      specFromForm({
        ...opened,
        period: 'year',
        yearBy: 'weekNumber',
        yearWeekRows: [{ week: null, weekdays: ['MO'] }],
      }),
    ).toBeNull();
    expect(recurrencePatch(opened)).toEqual({ ok: true, recurrenceRule: null });
    expect(isRecurring(opened)).toBe(false);
    // "日"没有位置可选：选了就算
    expect(recurrencePatch(daily)).toEqual({ ok: true, recurrenceRule: 'FREQ=DAILY' });
  });

  it('没选完的条件行忽略，选好的照常保存；年周的"最后一周"', () => {
    const state = {
      ...defaultRecurrenceForm(true),
      period: 'year' as const,
      yearBy: 'weekNumber' as const,
      yearWeekRows: [
        { week: -1, weekdays: ['MO' as const] },
        { week: 3, weekdays: [] },
      ],
    };
    expect(recurrencePatch(state)).toEqual({
      ok: true,
      recurrenceRule: 'FREQ=YEARLY;WKST=MO;BYWEEKNO=-1;BYDAY=MO',
    });
    expect(recurrenceFormFromRule('FREQ=YEARLY;WKST=MO;BYWEEKNO=-1;BYDAY=MO').yearWeekRows).toEqual(
      [{ week: -1, weekdays: ['MO'] }],
    );
  });

  it('没开和什么都没选保存出来一样', () => {
    expect(sameRecurrence(defaultRecurrenceForm(false), defaultRecurrenceForm(true))).toBe(true);
    expect(sameRecurrence(defaultRecurrenceForm(false), daily)).toBe(false);
  });
});

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

  it('打开循环：第二行的日期就是开始日期，不写截止日期；没选日期从今天开始', () => {
    const task = newTaskFromForm(form({ deadline: '2026-10-05', recurrence: daily }));
    expect(task.deadlineOn).toBeNull();
    expect(task.recurrenceRule).toBe('FREQ=DAILY');
    expect(task.recurrenceStartOn).toBe('2026-10-05');
    expect(newTaskFromForm(form({ recurrence: daily })).recurrenceStartOn).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  it('打开了循环但什么都没选：建的是普通任务', () => {
    const task = newTaskFromForm(
      form({ deadline: '2026-10-05', recurrence: defaultRecurrenceForm(true) }),
    );
    expect(task).toMatchObject({
      recurrenceRule: null,
      recurrenceStartOn: null,
      deadlineOn: '2026-10-05',
    });
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

  it('什么都没选不是错误（等同于没有开启循环）；间隔必须是正整数', () => {
    const weekly = { ...defaultRecurrenceForm(true), period: 'week' as const };
    expect(validateTaskForm(form({ recurrence: weekly }))).toEqual({});
    expect(validateTaskForm(form({ recurrence: { ...daily, interval: 0 } })).recurrence).toBe(
      '重复间隔需为正整数',
    );
  });
});

describe('编辑时保存的差异', () => {
  const saved = form({ deadline: '2026-10-01', importanceLevel: 2 });
  /** 已保存的循环任务：第二行显示当前这一次（10 月 5 日） */
  const recurringSaved = form({ deadline: '2026-10-05', recurrence: daily });

  it('没有改动时为空；只包含改动的字段', () => {
    expect(taskChangesFromForms(saved, saved)).toEqual({ stopRecurrenceAt: null, patch: {} });
    expect(taskChangesFromForms({ ...saved, importanceLevel: 3 }, saved).patch).toEqual({
      importanceLevel: 3,
    });
    expect(taskChangesFromForms({ ...saved, isStarred: true }, saved).patch).toEqual({
      isStarred: true,
    });
  });

  it('改截止时间；清空 → null', () => {
    expect(taskChangesFromForms({ ...saved, deadline: '2026-10-03' }, saved).patch.deadlineOn).toBe(
      '2026-10-03',
    );
    expect(taskChangesFromForms({ ...saved, deadline: '' }, saved).patch.deadlineOn).toBeNull();
  });

  it('空标题不写入（界面提示错误）', () => {
    expect(taskChangesFromForms({ ...saved, title: '  ' }, saved).patch).toEqual({});
  });

  it('打开循环：写规则和开始日期（第二行的日期）', () => {
    expect(taskChangesFromForms({ ...saved, recurrence: daily }, saved)).toEqual({
      stopRecurrenceAt: null,
      patch: { recurrenceRule: 'FREQ=DAILY', recurrenceStartOn: '2026-10-01' },
    });
  });

  it('打开了循环但什么都没选：等同于没有开启', () => {
    expect(
      taskChangesFromForms({ ...saved, recurrence: defaultRecurrenceForm(true) }, saved),
    ).toEqual({ stopRecurrenceAt: null, patch: {} });
  });

  it('循环任务改规则：只写规则，开始日期不变；第二行的日期不写', () => {
    expect(
      taskChangesFromForms({ ...recurringSaved, recurrence: mondays }, recurringSaved),
    ).toEqual({
      stopRecurrenceAt: null,
      patch: { recurrenceRule: 'FREQ=WEEKLY;WKST=MO;BYDAY=MO' },
    });
    expect(taskChangesFromForms({ ...recurringSaved, completed: true }, recurringSaved)).toEqual({
      stopRecurrenceAt: null,
      patch: {},
    });
  });

  it('关掉循环：当前这一次（第二行的日期）变成普通任务', () => {
    expect(
      taskChangesFromForms(
        { ...recurringSaved, recurrence: { ...daily, enabled: false } },
        recurringSaved,
      ),
    ).toEqual({ stopRecurrenceAt: '2026-10-05', patch: {} });
    // 关掉的同时改了日期、标了完成
    expect(
      taskChangesFromForms(
        {
          ...recurringSaved,
          recurrence: { ...daily, enabled: false },
          deadline: '2026-10-09',
          completed: true,
        },
        recurringSaved,
      ),
    ).toMatchObject({ stopRecurrenceAt: '2026-10-05', patch: { deadlineOn: '2026-10-09' } });
  });

  it('循环任务改成什么都不选：等同于关掉循环', () => {
    expect(
      taskChangesFromForms(
        { ...recurringSaved, recurrence: { ...defaultRecurrenceForm(true), period: 'week' } },
        recurringSaved,
      ),
    ).toEqual({ stopRecurrenceAt: '2026-10-05', patch: {} });
  });

  it('关掉又打开 = 重新设：先关掉，再按新的规则和第二行的日期开始', () => {
    expect(
      taskChangesFromForms(
        { ...recurringSaved, recurrence: { ...mondays, restarted: true }, deadline: '2026-10-12' },
        recurringSaved,
      ),
    ).toEqual({
      stopRecurrenceAt: '2026-10-05',
      patch: { recurrenceRule: 'FREQ=WEEKLY;WKST=MO;BYDAY=MO', recurrenceStartOn: '2026-10-12' },
    });
  });

  it('只换了没选中的标尺（例如月里的日子）不算改动', () => {
    expect(
      taskChangesFromForms(
        { ...recurringSaved, recurrence: { ...daily, monthDays: [1, 2, 3] } },
        recurringSaved,
      ).patch,
    ).toEqual({});
  });

  it('标记完成写入完成时间，取消写 null', () => {
    expect(
      taskChangesFromForms({ ...saved, completed: true }, saved).patch.completedAt,
    ).toBeInstanceOf(Date);
    const done = { ...saved, completed: true };
    expect(taskChangesFromForms({ ...done, completed: false }, done).patch.completedAt).toBeNull();
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
