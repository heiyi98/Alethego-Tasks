'use client';

import Link from 'next/link';

import { ListIcon, MatrixIcon } from './icons';
import { useSelection } from './selection';
import { selectionHref, withMode } from '@/lib/selection';

/**
 * 清单 / 时间管理矩阵切换（左上角，只有图标）：清单模式下显示矩阵图标，矩阵模式下显示清单图标。
 * 进入矩阵时地址里带着当前所在的页面（以及状态行），从矩阵回到清单时回到进入矩阵之前的那个页面。
 */
export function ModeToggle() {
  const selection = useSelection();
  const toMatrix = selection.mode !== 'matrix';
  const label = toMatrix ? '切换到矩阵' : '切换到清单';
  return (
    <Link
      href={selectionHref(withMode(selection, toMatrix ? 'matrix' : selection.listView))}
      className="icon-button mode-toggle"
      aria-label={label}
    >
      {toMatrix ? <MatrixIcon /> : <ListIcon />}
    </Link>
  );
}
