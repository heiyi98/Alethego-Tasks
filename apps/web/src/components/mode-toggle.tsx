'use client';

import Link from 'next/link';

import { ListIcon, MatrixIcon } from './icons';
import { useSelection } from './selection';
import { selectionHref } from '@/lib/selection';

/**
 * 清单 / 矩阵切换：只有图标。清单模式下显示矩阵图标（点击切到矩阵），矩阵模式下显示清单图标。
 * 从"已完成 / 已错过"切到矩阵时，矩阵上没有对应内容，改为显示"全部"。
 */
export function ModeToggle() {
  const selection = useSelection();
  const toMatrix = selection.mode === 'list';
  const label = toMatrix ? '切换到矩阵' : '切换到清单';
  const status =
    toMatrix && (selection.status === 'completed' || selection.status === 'missed')
      ? 'all'
      : selection.status;
  return (
    <Link
      href={selectionHref({ ...selection, status, mode: toMatrix ? 'matrix' : 'list' })}
      className="icon-button mode-toggle"
      aria-label={label}
      title={label}
    >
      {toMatrix ? <MatrixIcon /> : <ListIcon />}
    </Link>
  );
}
