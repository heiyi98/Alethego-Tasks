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
  it('时刻已过的实例都有记录，没勾选的立刻记为 missed；重复执行无副作用', async () => {
    const store = new InMemoryLocalStore();
    const task = await gymTask(store);
    const first = await syncOccurrences(store.occurrences, task, at('2026-09-25T10:00:00'));
    expect(first.map((o) => o.status)).toEqual(['missed', 'missed', 'missed']);
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

describe('改循环规则后的记录', () => {
  it('改规则：已发生的记录保持不变；之后新规则下到点的实例继续被记录', async () => {
    const store = new InMemoryLocalStore();
    const task = await gymTask(store);
    // 周一、三、五 07:00：到 9/25 周五 10:00 有 9/21、9/23、9/25 三条
    const before = await syncOccurrences(store.occurrences, task, at('2026-09-25T10:00:00'));
    await store.occurrences.setStatus(before[1]!.id, 'completed', sh('2026-09-23T08:00:00'));

    // 改成每天 20:00（开始时间不变）
    const changed = await store.tasks.update(task.id, { recurrenceRule: 'FREQ=DAILY;BYHOUR=20' });
    const after = await syncOccurrences(store.occurrences, changed, at('2026-09-28T21:00:00'));
    const rows = after.map((o) => [o.occurrenceDate.toISOString(), o.status]);
    // 旧记录原样保留（包括补登记的"已完成"）
    expect(rows.slice(0, 3)).toEqual([
      [sh('2026-09-21T07:00:00').toISOString(), 'missed'],
      [sh('2026-09-23T07:00:00').toISOString(), 'completed'],
      [sh('2026-09-25T07:00:00').toISOString(), 'missed'],
    ]);
    // 之后新规则下到点的实例（9/25 起每天 20:00）继续记录
    expect(rows.slice(3).map(([date]) => date)).toEqual(
      ['25', '26', '27', '28'].map((d) => sh(`2026-09-${d}T20:00:00`).toISOString()),
    );

    // 再过几天打开，仍在继续记录
    const later = await syncOccurrences(store.occurrences, changed, at('2026-09-30T21:00:00'));
    expect(later).toHaveLength(after.length + 2);
  });

  it('开始时间改早了：从新的开始时间补齐缺的记录，已有记录不动', async () => {
    const store = new InMemoryLocalStore();
    // 打开开关时默认的开始时间是今天 09:00，已经过了 → 立刻有一条
    const task = await store.tasks.create({
      title: '喝水',
      recurrenceRule: 'FREQ=DAILY',
      recurrenceDtstart: sh('2026-10-05T09:00:00'),
    });
    const first = await syncOccurrences(store.occurrences, task, at('2026-10-05T15:54:00'));
    expect(first).toHaveLength(1);
    await store.occurrences.setStatus(first[0]!.id, 'completed', sh('2026-10-05T10:00:00'));

    // 再把开始时间改到 9 月 1 日
    const earlier = await store.tasks.update(task.id, {
      recurrenceDtstart: sh('2026-09-01T09:00:00'),
    });
    const records = await syncOccurrences(store.occurrences, earlier, at('2026-10-05T15:54:00'), {
      backfillFrom: sh('2026-09-01T09:00:00'),
    });
    expect(records).toHaveLength(35); // 9/1 … 10/5
    expect(records[0]!.occurrenceDate).toEqual(sh('2026-09-01T09:00:00'));
    expect(records.at(-1)).toMatchObject({ id: first[0]!.id, status: 'completed' });
  });
});

describe('completeCurrentOccurrence', () => {
  it('完成当前代表实例，不改任务本身的 completed_at；代表实例随之顺延', async () => {
    const store = new InMemoryLocalStore();
    const task = await gymTask(store);
    const context = at('2026-09-25T06:00:00'); // 周五 07:00 之前
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
