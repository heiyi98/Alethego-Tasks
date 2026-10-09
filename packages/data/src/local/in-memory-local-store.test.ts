import { reconcileOccurrences, seriesFromTask } from '@alethego/core';
import { describe, expect, it } from 'vitest';

import { DataError } from '../errors';
import { InMemoryLocalStore } from './in-memory-local-store';

const OWNER = '11111111-1111-4111-8111-111111111111';

describe('InMemoryLocalStore', () => {
  it('快速添加：只需标题，归属当前用户，其余字段取默认值', async () => {
    const store = new InMemoryLocalStore({ ownerId: OWNER });
    const task = await store.tasks.create({ title: '  买牛奶 ' });
    expect(task).toMatchObject({
      ownerId: OWNER,
      title: '买牛奶',
      description: '',
      deadlineAt: null,
      importanceLevel: 0,
      recurrenceRule: null,
      isStarred: false,
      deletedAt: null,
    });

    // 标星只是书签，可随时切换
    expect((await store.tasks.update(task.id, { isStarred: true })).isStarred).toBe(true);
    expect((await store.tasks.getById(task.id))!.isStarred).toBe(true);

    // 之后在详情中补充字段
    const deadline = new Date('2026-09-30T10:00:00Z');
    expect(
      await store.tasks.update(task.id, { deadlineAt: deadline, importanceLevel: 3 }),
    ).toMatchObject({ deadlineAt: deadline, importanceLevel: 3 });
  });

  it('空白标题不能创建或更新', async () => {
    const store = new InMemoryLocalStore({ ownerId: OWNER });
    await expect(store.tasks.create({ title: '   ' })).rejects.toThrow(DataError);
    const task = await store.tasks.create({ title: 'x' });
    await expect(store.tasks.update(task.id, { title: '' })).rejects.toThrow(DataError);
  });

  it('列表默认按截止时间从近到远，无截止时间排最后', async () => {
    let tick = 0;
    const store = new InMemoryLocalStore({
      ownerId: OWNER,
      now: () => new Date(Date.UTC(2026, 8, 1) + tick++),
    });
    await store.tasks.create({ title: '无截止' });
    await store.tasks.create({ title: '下月', deadlineAt: new Date('2026-10-20T00:00:00Z') });
    await store.tasks.create({ title: '明天', deadlineAt: new Date('2026-09-26T00:00:00Z') });
    await store.tasks.create({ title: '也无截止' });
    expect((await store.tasks.list()).map((t) => t.title)).toEqual([
      '明天',
      '下月',
      '也无截止',
      '无截止',
    ]);
  });

  it('软删除：列表与详情不可见、不可编辑，数据与关联保留，可恢复', async () => {
    const store = new InMemoryLocalStore({ ownerId: OWNER });
    const work = await store.categories.create({ name: '工作', color: '#1E88E5' });
    const task = await store.tasks.create({ title: '周报' });
    await store.categories.setTaskCategories(task.id, [work.id]);

    await store.tasks.delete(task.id);
    await store.tasks.delete(task.id); // 重复删除无副作用
    expect(await store.tasks.list()).toEqual([]);
    expect(await store.tasks.getById(task.id)).toBeNull();
    await expect(store.tasks.update(task.id, { title: 'x' })).rejects.toThrow(DataError);
    expect(await store.categories.listCategoryIdsByTask([task.id])).toEqual(
      new Map([[task.id, [work.id]]]),
    );

    const restored = await store.tasks.restore(task.id);
    expect(restored.deletedAt).toBeNull();
    expect((await store.tasks.list({ categoryIds: [work.id] })).map((t) => t.id)).toEqual([
      task.id,
    ]);
  });

  it('分类筛选为逻辑或；删除分类只解除关联，不删除任务', async () => {
    const store = new InMemoryLocalStore({ ownerId: OWNER });
    const work = await store.categories.create({ name: '工作', color: '#1e88e5' });
    const home = await store.categories.create({ name: '家庭', color: '#43A047' });
    const a = await store.tasks.create({ title: 'A' });
    const b = await store.tasks.create({ title: 'B' });
    await store.tasks.create({ title: 'C' });
    await store.categories.setTaskCategories(a.id, [work.id]);
    await store.categories.setTaskCategories(b.id, [work.id, home.id]);

    const hit = await store.tasks.list({ categoryIds: [home.id, work.id] });
    expect(hit.map((t) => t.title).sort()).toEqual(['A', 'B']);
    expect(await store.tasks.list()).toHaveLength(3);

    await store.categories.delete(work.id);
    expect(await store.tasks.list()).toHaveLength(3);
    expect(await store.categories.listCategoryIdsByTask([a.id, b.id])).toEqual(
      new Map([[b.id, [home.id]]]),
    );
  });

  it('分类颜色可以重复', async () => {
    const store = new InMemoryLocalStore({ ownerId: OWNER });
    await store.categories.create({ name: '工作', color: '#1E88E5' });
    await expect(
      store.categories.create({ name: '学习', color: '#1e88e5' }),
    ).resolves.toMatchObject({
      color: '#1E88E5',
    });
  });

  it('落库归档结果：补建记录、用户改过的记录不被覆盖、重复记录被忽略', async () => {
    const store = new InMemoryLocalStore({ ownerId: OWNER });
    const task = await store.tasks.create({
      title: '健身',
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      recurrenceDtstart: new Date('2026-09-21T07:00:00+08:00'),
    });
    const series = seriesFromTask(task)!;
    const timeZone = 'Asia/Shanghai';

    // 周四：周一、周三的时刻都已过且没勾选 → 都记为 missed
    const thursday = { now: new Date('2026-09-24T10:00:00+08:00'), timeZone };
    await store.occurrences.applyReconcile(
      task.id,
      reconcileOccurrences(series, await store.occurrences.listByTask(task.id), thursday),
    );
    expect((await store.occurrences.listByTask(task.id)).map((o) => o.status)).toEqual([
      'missed',
      'missed',
    ]);

    // 周五 10:00：周五 07:00 已过 → missed；重复执行结果不变
    const friday = { now: new Date('2026-09-25T10:00:00+08:00'), timeZone };
    for (let i = 0; i < 2; i++) {
      await store.occurrences.applyReconcile(
        task.id,
        reconcileOccurrences(series, await store.occurrences.listByTask(task.id), friday),
      );
    }
    const records = await store.occurrences.listByTask(task.id);
    expect(records.map((o) => o.status)).toEqual(['missed', 'missed', 'missed']);

    // 用户事后补登记周三"其实做了"
    const wednesday = records[1]!;
    await store.occurrences.setStatus(wednesday.id, 'completed', friday.now);
    await store.occurrences.applyReconcile(
      task.id,
      reconcileOccurrences(series, await store.occurrences.listByTask(task.id), friday),
    );
    expect((await store.occurrences.listByTask(task.id))[1]?.status).toBe('completed');

    // 软删除任务不影响历史实例记录
    await store.tasks.delete(task.id);
    expect(await store.occurrences.listByTask(task.id)).toHaveLength(3);
  });
});

describe('分类编辑', () => {
  it('可以修改名称、描述、颜色；颜色可以和其他分类相同；名称不能为空', async () => {
    const store = new InMemoryLocalStore({ ownerId: OWNER });
    const work = await store.categories.create({ name: '工作', color: '#007AFF' });
    const home = await store.categories.create({
      name: ' 家庭 ',
      color: '#34C759',
      description: ' 家里的事 ',
    });
    expect(home).toMatchObject({ name: '家庭', description: '家里的事' });
    expect(work.description).toBe('');

    const edited = await store.categories.update(work.id, {
      name: '公司',
      description: '上班相关',
      color: '#ff9500',
    });
    expect(edited).toMatchObject({ name: '公司', description: '上班相关', color: '#FF9500' });

    // 换成别的分类正在用的颜色也可以
    await expect(store.categories.update(work.id, { color: '#34c759' })).resolves.toMatchObject({
      color: '#34C759',
    });
    await expect(store.categories.update(work.id, { name: '  ' })).rejects.toMatchObject({
      code: 'invalid',
    });
  });

  it('删除分类只解除关联，任务保留', async () => {
    const store = new InMemoryLocalStore({ ownerId: OWNER });
    const work = await store.categories.create({ name: '工作', color: '#007AFF' });
    const task = await store.tasks.create({ title: 't' });
    await store.categories.setTaskCategories(task.id, [work.id]);
    await store.categories.delete(work.id);
    expect(await store.tasks.getById(task.id)).not.toBeNull();
    expect(await store.categories.listCategoryIdsByTask([task.id])).toEqual(new Map());
  });
});

describe('组（本地只有自己一人）', () => {
  it('建组、建项目；组任务必须属于项目；组任务有重要性、不能收藏；删除组连同项目和任务一起删除', async () => {
    const store = new InMemoryLocalStore({ ownerId: OWNER });
    const group = await store.groups.create({ name: '  小组  ', kind: 'cooperative', color: null });
    expect(group).toMatchObject({ name: '小组', kind: 'cooperative', createdBy: OWNER });
    const project = await store.projects.create({
      groupId: group.id,
      name: ' 项目一 ',
      color: '#007AFF',
      tools: ['relations', 'assignment'],
      memberIds: [],
    });
    expect(project).toMatchObject({ name: '项目一', tools: ['assignment', 'relations'] });
    await expect(store.tasks.create({ title: 'x', groupId: group.id })).rejects.toMatchObject({
      code: 'invalid',
    });
    const fields = { groupId: group.id, projectId: project.id };
    const task = await store.tasks.create({ title: '组任务', ...fields });
    expect(task).toMatchObject({ groupId: group.id, projectId: project.id });
    await expect(
      (await store.tasks.create({ title: 'x', ...fields, importanceLevel: 3 })).importanceLevel,
    ).toBe(3);
    await expect(
      store.tasks.create({ title: 'x', ...fields, isStarred: true }),
    ).rejects.toMatchObject({ code: 'invalid' });
    expect((await store.groups.roster(group.id)).map((m) => m.isMe)).toEqual([true]);
    expect(await store.groups.requestDeletion(group.id)).toBe('deleted');
    expect(await store.groups.list()).toEqual([]);
    expect(await store.projects.list()).toEqual([]);
    expect(await store.tasks.getById(task.id)).toBeNull();
  });

  it('删除项目连同项目里的任务一起删除', async () => {
    const store = new InMemoryLocalStore({ ownerId: OWNER });
    const group = await store.groups.create({ name: '组', kind: 'management', color: null });
    const project = await store.projects.create({
      groupId: group.id,
      name: 'p',
      color: '#007AFF',
      tools: [],
      memberIds: [],
    });
    const task = await store.tasks.create({ title: 't', groupId: group.id, projectId: project.id });
    expect(await store.projects.requestDeletion(project.id)).toBe('deleted');
    expect(await store.tasks.getById(task.id)).toBeNull();
    expect(await store.groups.list()).toHaveLength(1);
  });
});

describe('任务关系（本地）', () => {
  it('开始于前置的结束 +1，结束是开始后 2 天；不能形成循环', async () => {
    const store = new InMemoryLocalStore({ ownerId: OWNER });
    const zone = 'Asia/Shanghai';
    const a = await store.tasks.create({
      title: 'A',
      deadlineAt: new Date('2026-10-05T15:59:59.999Z'),
    });
    const b = await store.tasks.create({ title: 'B' });
    const updated = await store.relations.setSchedule(b.id, {
      startOn: null,
      startRelations: [{ predecessorId: a.id, anchor: 'end', offsetDays: 1 }],
      endAfterDays: 2,
      endRelations: [],
      dateZone: zone,
    });
    expect(updated.startOn).toBe('2026-10-06');
    expect(updated.deadlineAt?.toISOString()).toBe('2026-10-08T15:59:59.999Z');
    expect(await store.relations.listForTasks([b.id])).toHaveLength(1);
    await expect(
      store.relations.setSchedule(a.id, {
        startOn: null,
        startRelations: [{ predecessorId: b.id, anchor: 'end', offsetDays: 0 }],
        endAfterDays: null,
        endRelations: [],
        dateZone: zone,
      }),
    ).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('子任务（本地存储）', () => {
  it('整组替换：改标题、加新的、没列出的标记删除；勾选按每一次各自记', async () => {
    let clock = new Date('2026-10-01T00:00:00Z');
    const store = new InMemoryLocalStore({ ownerId: 'u', now: () => clock });
    const task = await store.tasks.create({ title: '父任务' });
    const [a, b] = await store.subtasks.setList(task.id, [{ title: 'a' }, { title: 'b' }]);
    clock = new Date('2026-10-02T00:00:00Z');
    const next = await store.subtasks.setList(task.id, [
      { id: b!.id, title: 'b2' },
      { title: 'c' },
    ]);
    expect(next.map((s) => s.title)).toEqual(['b2', 'c']);
    const all = await store.subtasks.listForTasks([task.id]);
    expect(all.subtasks.find((s) => s.id === a!.id)!.deletedAt).not.toBeNull();
    const d1 = new Date('2026-10-03T01:00:00Z');
    await store.subtasks.setChecked(b!.id, d1, true);
    await store.subtasks.setChecked(b!.id, null, true);
    await store.subtasks.setChecked(b!.id, null, false);
    expect((await store.subtasks.listForTasks([task.id])).checks).toEqual([
      { subtaskId: b!.id, occurrenceDate: d1 },
    ]);
  });

  it('矩阵筛选存在账号设置里', async () => {
    const store = new InMemoryLocalStore({ ownerId: 'u' });
    expect(await store.settings.getMatrixFilter()).toBeNull();
    await store.settings.setMatrixFilter({ personal: false });
    expect(await store.settings.getMatrixFilter()).toEqual({ personal: false });
  });
});
