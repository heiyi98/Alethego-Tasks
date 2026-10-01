'use client';

import Link from 'next/link';

import { ListIcon, MatrixIcon } from './icons';
import { useSelection } from './selection';
import { selectionHref } from '@/lib/selection';

/**
 * 清单 / 矩阵切换：只有图标。清单模式下显示矩阵图标（点击切到矩阵），矩阵模式下显示清单图标。
 * 范围、分类、清单页的状态都原样带过去（矩阵不使用状态，切回清单时还是原来的状态）。
 * 组里没有矩阵，不显示切换。
 */
export function ModeToggle() {
  const selection = useSelection();
  if (selection.groupId) return null;
  const toMatrix = selection.mode === 'list';
  const label = toMatrix ? '切换到矩阵' : '切换到清单';
  return (
    <Link
      href={selectionHref({ ...selection, mode: toMatrix ? 'matrix' : 'list' })}
      className="icon-button mode-toggle"
      aria-label={label}
    >
      {toMatrix ? <MatrixIcon /> : <ListIcon />}
    </Link>
  );
}
