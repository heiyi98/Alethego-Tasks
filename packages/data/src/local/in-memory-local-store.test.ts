import { reconcileOccurrences, seriesFromTask } from '@alethego/core';
import { describe, expect, it } from 'vitest';

import { DataError } from '../errors';
import { LOCAL_OWNER_ID } from '../owner';
import { InMemoryLocalStore } from './in-memory-local-store';

describe('InMemoryLocalStore', () => {
  it('快速添加：只需标题，默认归属固定 owner，其余字段取默认值', async () => {
    const store = new InMemoryLocalStore();
    const task = await store.tasks.create({ title: '  买牛奶 ' });
    expect(task).toMatchObject({
      ownerId: LOCAL_OWNER_ID,
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
      await store.tasks.update(task.id, { deadlineAt: deadline, importanceLevel: 4 }),
    ).toMatchObject({ deadlineAt: deadline, importanceLevel: 4 });
  });

  it('空白标题不能创建或更新', async () => {
    const store = new InMemoryLocalStore();
    await expect(store.tasks.create({ title: '   ' })).rejects.toThrow(DataError);
    const task = await store.tasks.create({ title: 'x' });
    await expect(store.tasks.update(task.id, { title: '' })).rejects.toThrow(DataError);
  });

  it('列表默认按截止时间从近到远，无截止时间排最后', async () => {
    let tick = 0;
    const store = new InMemoryLocalStore({ now: () => new Date(Date.UTC(2026, 8, 1) + tick++) });
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
    const store = new InMemoryLocalStore();
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
    const store = new InMemoryLocalStore();
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

  it('分类颜色在用户范围内排他（不区分大小写）', async () => {
    const store = new InMemoryLocalStore();
    await store.categories.create({ name: '工作', color: '#1E88E5' });
    await expect(store.categories.create({ name: '学习', color: '#1e88e5' })).rejects.toThrow(
      DataError,
    );
  });

  it('落库归档结果：补建记录、只把 pending 改为 missed、重复记录被忽略', async () => {
    const store = new InMemoryLocalStore();
    const task = await store.tasks.create({
      title: '健身',
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      recurrenceDtstart: new Date('2026-09-21T07:00:00+08:00'),
    });
    const series = seriesFromTask(task)!;
    const timeZone = 'Asia/Shanghai';

    // 周四：周一、周三的记录生成（周一已被取代 → missed，周三 → pending）
    const thursday = { now: new Date('2026-09-24T10:00:00+08:00'), timeZone };
    await store.occurrences.applyReconcile(
      task.id,
      reconcileOccurrences(series, await store.occurrences.listByTask(task.id), thursday),
    );
    expect((await store.occurrences.listByTask(task.id)).map((o) => o.status)).toEqual([
      'missed',
      'pending',
    ]);

    // 周五：周三归档为 missed，生成周五 pending；重复执行结果不变
    const friday = { now: new Date('2026-09-25T10:00:00+08:00'), timeZone };
    for (let i = 0; i < 2; i++) {
      await store.occurrences.applyReconcile(
        task.id,
        reconcileOccurrences(series, await store.occurrences.listByTask(task.id), friday),
      );
    }
    const records = await store.occurrences.listByTask(task.id);
    expect(records.map((o) => o.status)).toEqual(['missed', 'missed', 'pending']);

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
  it('可以修改名称、描述、颜色；颜色不能与其他分类重复；名称不能为空', async () => {
    const store = new InMemoryLocalStore();
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

    // 保持自己的颜色不算冲突；换成别人的颜色冲突
    await expect(store.categories.update(work.id, { color: '#FF9500' })).resolves.toBeTruthy();
    await expect(store.categories.update(work.id, { color: '#34c759' })).rejects.toMatchObject({
      code: 'conflict',
    });
    await expect(store.categories.update(work.id, { name: '  ' })).rejects.toMatchObject({
      code: 'invalid',
    });
  });

  it('删除分类只解除关联，任务保留', async () => {
    const store = new InMemoryLocalStore();
    const work = await store.categories.create({ name: '工作', color: '#007AFF' });
    const task = await store.tasks.create({ title: 't' });
    await store.categories.setTaskCategories(task.id, [work.id]);
    await store.categories.delete(work.id);
    expect(await store.tasks.getById(task.id)).not.toBeNull();
    expect(await store.categories.listCategoryIdsByTask([task.id])).toEqual(new Map());
  });
});
