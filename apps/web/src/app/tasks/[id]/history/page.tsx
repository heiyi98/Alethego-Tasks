'use client';

import {
  calendarDaysBetween,
  type OccurrenceStatus,
  type RecurrenceOccurrence,
  type Task,
} from '@alethego/core';
import { syncOccurrences } from '@alethego/data';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useRepositories } from '@/components/repositories-provider';
import { browserTimeZone, errorMessage, formatFullDateTime, recurrenceLabel } from '@/lib/format';

/**
 * 循环任务的历史记录：每一次实例的完成 / 未完成状态。
 * 系统自动归档的"未完成"并非最终结论，用户可以随时在这里修改（例如事后补登记"那天其实做了"）。
 * 关闭循环开关后记录依然保留，仍可在此查看和修改。
 */

type LoadState =
  | { kind: 'loading' }
  | { kind: 'not_found' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; task: Task; records: RecurrenceOccurrence[] };

const STATUS_LABELS: Record<OccurrenceStatus, string> = {
  completed: '已完成',
  missed: '未完成',
  pending: '待完成',
};

export default function TaskHistoryPage() {
  const { id } = useParams<{ id: string }>();
  const repositories = useRepositories();
  const [timeZone] = useState(browserTimeZone);
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const task = await repositories.tasks.getById(id);
        if (!task) {
          if (!cancelled) setLoad({ kind: 'not_found' });
          return;
        }
        const records = await syncOccurrences(repositories.occurrences, task, {
          now: new Date(),
          timeZone: browserTimeZone(),
        });
        if (!cancelled) setLoad({ kind: 'ready', task, records });
      } catch (e) {
        if (!cancelled) setLoad({ kind: 'error', message: errorMessage(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, repositories]);

  async function setStatus(record: RecurrenceOccurrence, status: 'completed' | 'missed') {
    if (load.kind !== 'ready' || record.status === status) return;
    setSaving(record.id);
    try {
      const updated = await repositories.occurrences.setStatus(
        record.id,
        status,
        status === 'completed' ? new Date() : null,
      );
      setLoad({
        ...load,
        records: load.records.map((r) => (r.id === updated.id ? updated : r)),
      });
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(null);
    }
  }

  const backLink = (
    <Link href={`/tasks/${id}`} className="back-link">
      ← 返回任务
    </Link>
  );

  if (load.kind !== 'ready') {
    return (
      <main className="page">
        {backLink}
        <p className="muted">
          {load.kind === 'loading'
            ? '加载中…'
            : load.kind === 'not_found'
              ? '任务不存在或已删除。'
              : `加载失败：${load.message}`}
        </p>
      </main>
    );
  }

  const { task, records } = load;
  const newestFirst = [...records].reverse();
  const completedCount = records.filter((r) => r.status === 'completed').length;
  const today = new Date();

  return (
    <main className="page">
      {backLink}
      <header className="history-header">
        <h1>{task.title}</h1>
        <p className="muted">
          {task.recurrenceRule
            ? `↻ ${recurrenceLabel(task.recurrenceRule, timeZone)}`
            : '循环已关闭，历史记录保留'}
          {records.length > 0 && ` · 共 ${records.length} 次，完成 ${completedCount} 次`}
        </p>
      </header>

      {error && <p className="notice notice-error">修改失败：{error}</p>}

      {records.length === 0 ? (
        <p className="muted empty">还没有历史记录。每次实例到了当天才会生成记录。</p>
      ) : (
        <ul className="task-list history-list" aria-label="历史记录">
          {newestFirst.map((record) => {
            const early = calendarDaysBetween(today, record.occurrenceDate, timeZone) > 0;
            return (
              <li key={record.id} className={`history-row history-${record.status}`}>
                <div className="history-main">
                  <span className="history-date">
                    {formatFullDateTime(record.occurrenceDate, timeZone)}
                  </span>
                  <span className="history-status" data-status={record.status}>
                    {STATUS_LABELS[record.status]}
                    {early && record.status === 'completed' && '（提前完成）'}
                  </span>
                </div>
                <div
                  className="segmented"
                  role="group"
                  aria-label={`修改 ${formatFullDateTime(record.occurrenceDate, timeZone)} 的状态`}
                >
                  {(['completed', 'missed'] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      aria-pressed={record.status === status}
                      disabled={saving === record.id}
                      onClick={() => setStatus(record, status)}
                    >
                      {status === 'completed' ? '完成' : '未完成'}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
