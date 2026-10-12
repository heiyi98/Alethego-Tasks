import { resolveRepresentativeInstance, seriesFromTask } from '@alethego/core';
import { describe, expect, it } from 'vitest';

import { DataError } from '../errors';
import { InMemoryLocalStore } from '../local/in-memory-local-store';
import { completeCurrentOccurrence, syncOccurrences } from './occurrence-sync';

const OWNER = '11111111-1111-4111-8111-111111111111';

const timeZone = 'Asia/Shanghai';
const sh = (local: string) => new Date(`${local}+08:00`);
const at = (local: string) => ({ now: sh(local), timeZone });

async function gymTask(store: InMemoryLocalStore) {
  // 周一、三、五；2026-09-21 是周一
  return store.tasks.create({
    title: '健身',
    recurrenceRule: 'FREQ=WEEKLY;WKST=MO;BYDAY=MO,WE,FR',
    recurrenceStartOn: '2026-09-21',
  });
}

describe('syncOccurrences', () => {
  it('过去的日子都有记录，没勾选的记为 missed；当天不算过去；重复执行无副作用', async () => {
    const store = new InMemoryLocalStore({ ownerId: OWNER });
    const task = await gymTask(store);
    const friday = await syncOccurrences(store.occurrences, task, at('2026-09-25T23:00:00'));
    expect(friday.map((o) => o.occurrenceDate)).toEqual(['2026-09-21', '2026-09-23']);
    const saturday = await syncOccurrences(store.occurrences, task, at('2026-09-26T10:00:00'));
    expect(saturday.map((o) => o.status)).toEqual(['missed', 'missed', 'missed']);
    const again = await syncOccurrences(store.occurrences, task, at('2026-09-26T10:00:00'));
    expect(again).toEqual(saturday);
  });

  it('循环开关关闭后只读取历史记录，不再生成', async () => {
    const store = new InMemoryLocalStore({ ownerId: OWNER });
    const task = await gymTask(store);
    await syncOccurrences(store.occurrences, task, at('2026-09-24T10:00:00'));
    const off = await store.tasks.update(task.id, { recurrenceRule: null });
    const records = await syncOccurrences(store.occurrences, off, at('2026-10-30T10:00:00'));
    expect(records).toHaveLength(2);
  });
});

describe('改循环规则后的记录', () => {
  it('改规则：已发生的记录保持不变；之后新规则下过去的日子继续被记录', async () => {
    const store = new InMemoryLocalStore({ ownerId: OWNER });
    const task = await gymTask(store);
    const before = await syncOccurrences(store.occurrences, task, at('2026-09-26T10:00:00'));
    await store.occurrences.setStatus(before[1]!.id, 'completed', sh('2026-09-23T08:00:00'));

    // 改成每天（开始日期不变）
    const changed = await store.tasks.update(task.id, { recurrenceRule: 'FREQ=DAILY' });
    const after = await syncOccurrences(store.occurrences, changed, at('2026-09-29T21:00:00'));
    const rows = after.map((o) => [o.occurrenceDate, o.status]);
    // 旧记录原样保留（包括补登记的"已完成"）
    expect(rows.slice(0, 3)).toEqual([
      ['2026-09-21', 'missed'],
      ['2026-09-23', 'completed'],
      ['2026-09-25', 'missed'],
    ]);
    // 之后新规则下过去的日子继续记录（9/29 当天还没过去）
    expect(rows.slice(3).map(([date]) => date)).toEqual(['2026-09-26', '2026-09-27', '2026-09-28']);
  });

  it('开始日期改早了：从新的开始日期补齐缺的记录，已有记录不动', async () => {
    const store = new InMemoryLocalStore({ ownerId: OWNER });
    const task = await store.tasks.create({
      title: '喝水',
      recurrenceRule: 'FREQ=DAILY',
      recurrenceStartOn: '2026-10-04',
    });
    const first = await syncOccurrences(store.occurrences, task, at('2026-10-05T15:54:00'));
    expect(first).toHaveLength(1);
    await store.occurrences.setStatus(first[0]!.id, 'completed', sh('2026-10-04T10:00:00'));

    const earlier = await store.tasks.update(task.id, { recurrenceStartOn: '2026-09-01' });
    const records = await syncOccurrences(store.occurrences, earlier, at('2026-10-05T15:54:00'), {
      backfillFrom: '2026-09-01',
    });
    expect(records).toHaveLength(34); // 9/1 … 10/4
    expect(records[0]!.occurrenceDate).toBe('2026-09-01');
    expect(records.at(-1)).toMatchObject({ id: first[0]!.id, status: 'completed' });
  });
});

describe('completeCurrentOccurrence', () => {
  it('完成当前代表实例（今天这一次），不改任务本身的 completed_at；代表实例随之顺延', async () => {
    const store = new InMemoryLocalStore({ ownerId: OWNER });
    const task = await gymTask(store);
    const context = at('2026-09-25T20:00:00'); // 周五
    const records = await syncOccurrences(store.occurrences, task, context);

    const done = await completeCurrentOccurrence(store.occurrences, task, records, context);
    expect(done).toMatchObject({ occurrenceDate: '2026-09-25', status: 'completed' });
    expect((await store.tasks.getById(task.id))?.completedAt).toBeNull();

    const after = await store.occurrences.listByTask(task.id);
    expect(
      resolveRepresentativeInstance(seriesFromTask(task)!, after, context)?.occurrenceDate,
    ).toBe('2026-09-28');
  });

  it('提前完成尚无记录的下一次：新建一条已完成记录，过去后不会被重新生成或归档', async () => {
    const store = new InMemoryLocalStore({ ownerId: OWNER });
    const task = await gymTask(store);
    const thursday = at('2026-09-24T10:00:00'); // 代表实例是周五，尚无记录
    const records = await syncOccurrences(store.occurrences, task, thursday);
    expect(records.map((o) => o.occurrenceDate)).not.toContain('2026-09-25');

    await completeCurrentOccurrence(store.occurrences, task, records, thursday);
    const saturday = await syncOccurrences(store.occurrences, task, at('2026-09-26T10:00:00'));
    expect(saturday.find((o) => o.occurrenceDate === '2026-09-25')).toMatchObject({
      status: 'completed',
    });
    expect(saturday.filter((o) => o.status === 'pending')).toEqual([]);
  });

  it('手动修改历史记录：missed ↔ completed', async () => {
    const store = new InMemoryLocalStore({ ownerId: OWNER });
    const task = await gymTask(store);
    const [monday] = await syncOccurrences(store.occurrences, task, at('2026-09-25T10:00:00'));
    const fixed = await store.occurrences.setStatus(
      monday!.id,
      'completed',
      sh('2026-09-25T11:00:00'),
    );
    expect(fixed.status).toBe('completed');
    const again = await syncOccurrences(store.occurrences, task, at('2026-09-29T10:00:00'));
    expect(again[0]?.status).toBe('completed');
  });
});

describe('循环规则校验', () => {
  it('无效规则或缺少开始日期不能保存', async () => {
    const store = new InMemoryLocalStore({ ownerId: OWNER });
    await expect(
      store.tasks.create({
        title: 'x',
        recurrenceRule: 'FREQ=NOPE',
        recurrenceStartOn: '2026-10-01',
      }),
    ).rejects.toThrow(DataError);
    const task = await store.tasks.create({ title: 'y' });
    await expect(
      store.tasks.update(task.id, { recurrenceRule: 'FREQ=DAILY', recurrenceStartOn: null }),
    ).rejects.toThrow(DataError);
  });
});
