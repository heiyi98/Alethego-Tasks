import { describe, expect, it } from 'vitest';

import { DataError } from '../errors';
import { InMemoryLocalStore } from '../local/in-memory-local-store';
import { loadTaskDetail, saveTaskExtensions } from './task-detail-aggregator';

const OWNER = '11111111-1111-4111-8111-111111111111';

describe('TaskDetailAggregator', () => {
  it('拼装任务、分类与人物（名字 + 备注）', async () => {
    const store = new InMemoryLocalStore({ ownerId: OWNER });
    const task = await store.tasks.create({ title: '签合同' });
    const work = await store.categories.create({ name: '工作', color: '#1E88E5' });
    await store.categories.setTaskCategories(task.id, [work.id]);
    await saveTaskExtensions(store, task.id, {
      people: [
        { name: '张三', note: '客户' },
        { name: '李四', note: '' },
      ],
    });

    const detail = await loadTaskDetail(store, task.id);
    expect(detail).toMatchObject({
      task: { id: task.id },
      categoryIds: [work.id],
      people: [
        { name: '张三', note: '客户', contactId: null },
        { name: '李四', note: '' },
      ],
    });
    expect(detail).not.toHaveProperty('location');
  });

  it('人物：带 id 的更新、新增、未出现的删除', async () => {
    const store = new InMemoryLocalStore({ ownerId: OWNER });
    const task = await store.tasks.create({ title: 't' });
    const first = await saveTaskExtensions(store, task.id, {
      people: [
        { name: 'A', note: '' },
        { name: 'B', note: '' },
      ],
    });
    const [a] = first.people;

    const second = await saveTaskExtensions(store, task.id, {
      people: [
        { id: a!.id, name: 'A2', note: '同事' },
        { name: 'C', note: '' },
      ],
    });
    expect(second.people.map((p) => [p.name, p.note])).toEqual([
      ['A2', '同事'],
      ['C', ''],
    ]);
    expect(second.people[0]!.id).toBe(a!.id);
  });

  it('人物缺少姓名时整体不保存', async () => {
    const store = new InMemoryLocalStore({ ownerId: OWNER });
    const task = await store.tasks.create({ title: 't' });
    await expect(
      saveTaskExtensions(store, task.id, { people: [{ name: '', note: '客户' }] }),
    ).rejects.toThrow(DataError);
    expect(await store.people.listByTask(task.id)).toEqual([]);
  });

  it('已删除的任务没有详情', async () => {
    const store = new InMemoryLocalStore({ ownerId: OWNER });
    const task = await store.tasks.create({ title: 't' });
    await store.tasks.delete(task.id);
    expect(await loadTaskDetail(store, task.id)).toBeNull();
  });
});
