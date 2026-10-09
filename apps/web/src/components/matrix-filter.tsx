'use client';

import { DEFAULT_MATRIX_FILTER, parseMatrixFilter, type MatrixFilter } from '@alethego/core';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useRepositories } from './repositories-provider';

interface MatrixFilterValue {
  filter: MatrixFilter;
  /** 已经从账号上读到上一次的勾选 */
  loaded: boolean;
  setFilter: (next: MatrixFilter) => void;
}

const MatrixFilterContext = createContext<MatrixFilterValue | null>(null);

/**
 * 时间管理矩阵的筛选（勾选）：存在账号上（taskapp.users.matrix_filter），换设备也一样；
 * 不管从哪个页面进入矩阵，都显示上一次的勾选。第一次进入时只勾"个人"。
 */
export function MatrixFilterProvider({ children }: { children: ReactNode }) {
  const repositories = useRepositories();
  const [filter, setState] = useState<MatrixFilter>(DEFAULT_MATRIX_FILTER);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    repositories.settings
      .getMatrixFilter()
      .then((stored) => {
        if (cancelled) return;
        setState(parseMatrixFilter(stored));
        setLoaded(true);
      })
      .catch(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [repositories]);

  const setFilter = useCallback(
    (next: MatrixFilter) => {
      setState(next);
      void repositories.settings.setMatrixFilter(next).catch(() => {
        // 存不上时这次照常显示，下次进入矩阵按账号上存的
      });
    },
    [repositories],
  );

  const value = useMemo(() => ({ filter, loaded, setFilter }), [filter, loaded, setFilter]);
  return <MatrixFilterContext.Provider value={value}>{children}</MatrixFilterContext.Provider>;
}

export function useMatrixFilter(): MatrixFilterValue {
  const value = useContext(MatrixFilterContext);
  if (!value) throw new Error('useMatrixFilter 必须在 MatrixFilterProvider 内使用');
  return value;
}
