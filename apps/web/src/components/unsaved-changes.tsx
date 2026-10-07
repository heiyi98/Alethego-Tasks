'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';

import { useFeedback } from './feedback-provider';

/**
 * 未保存的修改。所有原地编辑都只在点 ✓（或单行输入框里按回车）时保存；有没保存的修改时：
 * - 刷新或关闭页面：浏览器自己的离开提示（beforeunload）
 * - 在应用里点了正在编辑的区域以外的任何地方（切换页面、组、项目、账号，打开另一个任务，点别处收起）：
 *   先拦下这次点击，弹出确认框——放弃修改（丢掉改动后照常执行这次点击），或继续编辑（什么都不做）
 *
 * 每个编辑区域用 useUnsavedChanges 登记：有没有改动、放弃时怎么还原、自己的范围（点范围内不拦）。
 */

interface Source {
  isDirty: () => boolean;
  discard: () => void;
  container: RefObject<Element | null>;
}

interface UnsavedValue {
  register: (source: Source) => () => void;
  hasUnsaved: () => boolean;
  /** 有改动时先确认；放弃修改或本来就没有改动时执行 action，返回是否执行了 */
  guard: (action: () => void) => Promise<boolean>;
}

const UnsavedContext = createContext<UnsavedValue | null>(null);

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const { confirm } = useFeedback();
  const sources = useRef(new Set<Source>());
  const asking = useRef(false);

  const hasUnsaved = useCallback(() => [...sources.current].some((s) => s.isDirty()), []);

  const guard = useCallback(
    async (action: () => void) => {
      if (!hasUnsaved()) {
        action();
        return true;
      }
      if (asking.current) return false;
      asking.current = true;
      const discard = await confirm({
        message: '有未保存的修改',
        confirmLabel: '放弃修改',
        cancelLabel: '继续编辑',
        destructive: true,
        textButtons: true,
      });
      asking.current = false;
      if (!discard) return false;
      for (const source of [...sources.current]) if (source.isDirty()) source.discard();
      action();
      return true;
    },
    [confirm, hasUnsaved],
  );

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsaved()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    // 捕获阶段拦下编辑区域以外的点击（链接、按钮、别的任务……），确认后再把这次点击原样补上
    const onClick = (event: MouseEvent) => {
      const dirty = [...sources.current].filter((s) => s.isDirty());
      if (dirty.length === 0) return;
      const target = event.target as Element | null;
      if (!target || !document.contains(target)) return;
      if (target.closest('[data-keep-panel]')) return;
      if (dirty.some((s) => s.container.current?.contains(target))) return;
      event.preventDefault();
      event.stopPropagation();
      void guard(() => {
        if (target instanceof HTMLElement && document.contains(target)) target.click();
      });
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [guard, hasUnsaved]);

  const register = useCallback((source: Source) => {
    sources.current.add(source);
    return () => {
      sources.current.delete(source);
    };
  }, []);

  const value = useMemo(() => ({ register, hasUnsaved, guard }), [register, hasUnsaved, guard]);
  return <UnsavedContext.Provider value={value}>{children}</UnsavedContext.Provider>;
}

export function useUnsaved(): UnsavedValue {
  const value = useContext(UnsavedContext);
  if (!value) throw new Error('useUnsaved 必须在 UnsavedChangesProvider 内使用');
  return value;
}

/**
 * 登记一个编辑区域。isDirty / discard 每次渲染取最新的；container 是这个区域的根元素，
 * 在它里面的点击不拦。
 */
export function useUnsavedChanges(
  container: RefObject<Element | null>,
  isDirty: () => boolean,
  discard: () => void,
) {
  const { register } = useUnsaved();
  const latest = useRef({ isDirty, discard });
  latest.current = { isDirty, discard };
  useEffect(
    () =>
      register({
        container,
        isDirty: () => latest.current.isDirty(),
        discard: () => latest.current.discard(),
      }),
    [register, container],
  );
}

/** 单行输入框里按回车 = 点 ✓（输入法组字时的回车不算） */
export function isSaveEnter(event: React.KeyboardEvent): boolean {
  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return false;
  const target = event.target as HTMLElement;
  if (!(target instanceof HTMLInputElement)) return false;
  return !['checkbox', 'radio', 'button', 'submit', 'color', 'file', 'range'].includes(target.type);
}
