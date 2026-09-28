'use client';

import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { emptyTaskForm, type TaskFormValue } from '@/lib/task-form';

/**
 * 任务面板的全局状态：
 * - 同一时间只展开一个面板（新建面板，或某个任务的编辑面板）；展开另一个时当前的自动收起
 * - 收起不等于放弃：新建草稿保存在这里，收起再展开内容仍在
 */

export type ActivePanel =
  { kind: 'create' } | { kind: 'edit'; taskId: string; surface: 'inline' | 'floating' } | null;

/**
 * 新建草稿。categoryIds / isStarred 为 null 表示用户还没动过，沿用当前页面的默认值
 * （所选分类；在"收藏"里默认标星）。
 */
export type CreateDraft = Omit<TaskFormValue, 'categoryIds' | 'isStarred'> & {
  categoryIds: string[] | null;
  isStarred: boolean | null;
};

const freshDraft = (): CreateDraft => ({ ...emptyTaskForm(), categoryIds: null, isStarred: null });

interface PanelValue {
  active: ActivePanel;
  open: (panel: NonNullable<ActivePanel>) => void;
  close: () => void;
  isOpen: (panel: NonNullable<ActivePanel>) => boolean;
  draft: CreateDraft;
  setDraft: (update: (draft: CreateDraft) => CreateDraft) => void;
  resetDraft: () => void;
}

const PanelContext = createContext<PanelValue | null>(null);

const samePanel = (a: ActivePanel, b: ActivePanel) =>
  a?.kind === b?.kind && (a?.kind !== 'edit' || (b?.kind === 'edit' && a.taskId === b.taskId));

export function PanelProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActivePanel>(null);
  const [draft, setDraftState] = useState<CreateDraft>(freshDraft);
  const pathname = usePathname();

  // 切换页面时收起面板（新建草稿保留）
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    setActive(null);
  }, [pathname]);

  const open = useCallback((panel: NonNullable<ActivePanel>) => setActive(panel), []);
  const close = useCallback(() => setActive(null), []);
  const isOpen = useCallback(
    (panel: NonNullable<ActivePanel>) => samePanel(active, panel),
    [active],
  );
  const setDraft = useCallback(
    (update: (draft: CreateDraft) => CreateDraft) => setDraftState(update),
    [],
  );
  const resetDraft = useCallback(() => setDraftState(freshDraft()), []);

  return (
    <PanelContext.Provider value={{ active, open, close, isOpen, draft, setDraft, resetDraft }}>
      {children}
    </PanelContext.Provider>
  );
}

export function usePanels(): PanelValue {
  const value = useContext(PanelContext);
  if (!value) throw new Error('usePanels 必须在 PanelProvider 内使用');
  return value;
}
