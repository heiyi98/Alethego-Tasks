'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

import { useTaskData } from './task-data-provider';
import { parseSelection, type Selection } from '@/lib/selection';

/**
 * 当前的菜单选择（来自 URL）。数据加载后去掉已不存在的分类 id（例如分类刚被删除）。
 * 使用 useSearchParams，调用方需在 Suspense 内。
 */
export function useSelection(): Selection {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data } = useTaskData();
  const query = searchParams.toString();
  return useMemo(() => {
    const raw = parseSelection(pathname, new URLSearchParams(query));
    if (!data) return raw;
    const existing = new Set(data.categories.map((c) => c.id));
    return { ...raw, categoryIds: raw.categoryIds.filter((id) => existing.has(id)) };
  }, [pathname, query, data]);
}
