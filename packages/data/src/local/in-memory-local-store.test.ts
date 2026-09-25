import { reconcileOccurrences, seriesFromTask } from '@alethego/core';
import { describe, expect, it } from 'vitest';

import { DataError } from '../errors';
import { InMemoryLocalStore } from './in-memory-local-store';

describe('InMemoryLocalStore', () => {
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

    // 删除任务时实例记录一并删除
    await store.tasks.delete(task.id);
    expect(await store.occurrences.listByTask(task.id)).toEqual([]);
  });
});
