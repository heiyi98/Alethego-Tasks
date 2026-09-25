import { resolveRepresentativeInstance, seriesFromTask } from '@alethego/core';
import { describe, expect, it } from 'vitest';

import { DataError } from '../errors';
import { InMemoryLocalStore } from '../local/in-memory-local-store';
import { completeCurrentOccurrence, syncOccurrences } from './occurrence-sync';

const timeZone = 'Asia/Shanghai';
const sh = (local: string) => new Date(`${local}+08:00`);
const at = (local: string) => ({ now: sh(local), timeZone });

async function gymTask(store: InMemoryLocalStore) {
  return store.tasks.create({
    title: '健身',
    recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
    recurrenceDtstart: sh('2026-09-21T07:00:00'),
  });
}

describe('syncOccurrences', () => {
  it('生成已出现实例的记录，被取代的直接归档为 missed；重复执行无副作用', async () => {
    const store = new InMemoryLocalStore();
    const task = await gymTask(store);
    const first = await syncOccurrences(store.occurrences, task, at('2026-09-25T10:00:00'));
    expect(first.map((o) => o.status)).toEqual(['missed', 'missed', 'pending']);
    const again = await syncOccurrences(store.occurrences, task, at('2026-09-25T10:00:00'));
    expect(again).toEqual(first);
  });

  it('循环开关关闭后只读取历史记录，不再生成', async () => {
    const store = new InMemoryLocalStore();
    const task = await gymTask(store);
    await syncOccurrences(store.occurrences, task, at('2026-09-23T10:00:00'));
    const off = await store.tasks.update(task.id, { recurrenceRule: null });
    const records = await syncOccurrences(store.occurrences, off, at('2026-10-30T10:00:00'));
    expect(records).toHaveLength(2);
  });
});

describe('completeCurrentOccurrence', () => {
  it('完成当前代表实例，不改任务本身的 completed_at；代表实例随之顺延', async () => {
    const store = new InMemoryLocalStore();
    const task = await gymTask(store);
    const context = at('2026-09-25T10:00:00'); // 周五
    const records = await syncOccurrences(store.occurrences, task, context);

    const done = await completeCurrentOccurrence(store.occurrences, task, records, context);
    expect(done).toMatchObject({ occurrenceDate: sh('2026-09-25T07:00:00'), status: 'completed' });
    expect((await store.tasks.getById(task.id))?.completedAt).toBeNull();

    const after = await store.occurrences.listByTask(task.id);
    expect(
      resolveRepresentativeInstance(seriesFromTask(task)!, after, context)?.occurrenceAt,
    ).toEqual(sh('2026-09-28T07:00:00'));
  });

  it('提前完成尚无记录的下一次实例：新建一条已完成记录，到期后不会被重新生成或归档', async () => {
    const store = new InMemoryLocalStore();
    const task = await gymTask(store);
    const thursday = at('2026-09-24T10:00:00'); // 代表实例是周五，尚无记录
    const records = await syncOccurrences(store.occurrences, task, thursday);
    expect(records.map((o) => o.occurrenceDate)).not.toContainEqual(sh('2026-09-25T07:00:00'));

    await completeCurrentOccurrence(store.occurrences, task, records, thursday);
    const friday = await syncOccurrences(store.occurrences, task, at('2026-09-25T10:00:00'));
    expect(
      friday.find((o) => o.occurrenceDate.getTime() === sh('2026-09-25T07:00:00').getTime()),
    ).toMatchObject({ status: 'completed' });
    expect(friday.filter((o) => o.status === 'pending')).toEqual([]);
  });

  it('手动修改历史记录：missed ↔ completed', async () => {
    const store = new InMemoryLocalStore();
    const task = await gymTask(store);
    const [monday] = await syncOccurrences(store.occurrences, task, at('2026-09-25T10:00:00'));
    const fixed = await store.occurrences.setStatus(
      monday!.id,
      'completed',
      sh('2026-09-25T11:00:00'),
    );
    expect(fixed.status).toBe('completed');
    // 之后的同步不会把用户修改过的记录改回去
    const again = await syncOccurrences(store.occurrences, task, at('2026-09-29T10:00:00'));
    expect(again[0]?.status).toBe('completed');
  });
});

describe('循环规则校验', () => {
  it('无效规则或缺少起始时间不能保存', async () => {
    const store = new InMemoryLocalStore();
    await expect(
      store.tasks.create({
        title: 'x',
        recurrenceRule: 'FREQ=NOPE',
        recurrenceDtstart: new Date(),
      }),
    ).rejects.toThrow(DataError);
    const task = await store.tasks.create({ title: 'y' });
    await expect(
      store.tasks.update(task.id, { recurrenceRule: 'FREQ=DAILY', recurrenceDtstart: null }),
    ).rejects.toThrow(DataError);
  });
});
