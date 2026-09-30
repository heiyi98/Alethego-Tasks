import { describe, expect, it } from 'vitest';

import { DataError } from '../errors';
import { InMemoryLocalStore } from '../local/in-memory-local-store';
import { loadTaskDetail, saveTaskExtensions } from './task-detail-aggregator';

const OWNER = '11111111-1111-4111-8111-111111111111';

describe('TaskDetailAggregator', () => {
  it('拼装任务、分类、地点与人物', async () => {
    const store = new InMemoryLocalStore({ ownerId: OWNER });
    const task = await store.tasks.create({ title: '签合同' });
    const work = await store.categories.create({ name: '工作', color: '#1E88E5' });
    await store.categories.setTaskCategories(task.id, [work.id]);
    await saveTaskExtensions(store, task.id, {
      location: { name: ' 客户公司 ', address: '人民路 1 号' },
      people: [
        { name: '张三', relation: '客户' },
        { name: '李四', relation: '' },
      ],
    });

    const detail = await loadTaskDetail(store, task.id);
    expect(detail).toMatchObject({
      task: { id: task.id },
      categoryIds: [work.id],
      location: { name: '客户公司', address: '人民路 1 号', placeId: null, lat: null, lng: null },
      people: [
        { name: '张三', relation: '客户', contactId: null },
        { name: '李四', relation: '' },
      ],
    });
  });

  it('人物：带 id 的更新、新增、未出现的删除；地点清空即删除', async () => {
    const store = new InMemoryLocalStore({ ownerId: OWNER });
    const task = await store.tasks.create({ title: 't' });
    const first = await saveTaskExtensions(store, task.id, {
      location: { name: '家', address: '' },
      people: [
        { name: 'A', relation: '' },
        { name: 'B', relation: '' },
      ],
    });
    const [a] = first.people;

    const second = await saveTaskExtensions(store, task.id, {
      location: { name: '  ', address: '' },
      people: [
        { id: a!.id, name: 'A2', relation: '同事' },
        { name: 'C', relation: '' },
      ],
    });
    expect(second.location).toBeNull();
    expect(second.people.map((p) => [p.name, p.relation])).toEqual([
      ['A2', '同事'],
      ['C', ''],
    ]);
    expect(second.people[0]!.id).toBe(a!.id);
    expect(await store.locations.getByTask(task.id)).toBeNull();
  });

  it('人物缺少姓名时整体不保存（地点也不写入）', async () => {
    const store = new InMemoryLocalStore({ ownerId: OWNER });
    const task = await store.tasks.create({ title: 't' });
    await expect(
      saveTaskExtensions(store, task.id, {
        location: { name: '公司', address: '' },
        people: [{ name: '', relation: '客户' }],
      }),
    ).rejects.toThrow(DataError);
    expect(await store.locations.getByTask(task.id)).toBeNull();
  });

  it('已删除的任务没有详情', async () => {
    const store = new InMemoryLocalStore({ ownerId: OWNER });
    const task = await store.tasks.create({ title: 't' });
    await store.tasks.delete(task.id);
    expect(await loadTaskDetail(store, task.id)).toBeNull();
  });
});
