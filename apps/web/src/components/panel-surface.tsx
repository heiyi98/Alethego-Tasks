'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

const SWIPE_CLOSE_PX = 80;

/**
 * 面板外壳：负责"收起"的各种方式，内容由 TaskEditor 提供。
 * - 桌面：inline（在原地展开）或 floating（在矩阵页上弹出）；点面板外空白处或按 Esc 收起
 * - 手机（≤ 760px）：两种都显示为底部抽屉；下滑或点背景遮罩收起
 * 收起只是隐藏，不丢弃内容。
 *
 * 带 data-panel-anchor 的元素（例如展开三角、任务行本身）自己负责切换，点击它们不算"面板外"；
 * 带 data-keep-panel 的元素（确认框、撤销提示条）也不会触发收起。
 */
export function PanelSurface({
  variant,
  label,
  onClose,
  children,
}: {
  variant: 'inline' | 'floating';
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragY, setDragY] = useState(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target || !document.contains(target)) return;
      if (ref.current?.contains(target)) return;
      if (target.closest('[data-panel-anchor], [data-keep-panel]')) return;
      onCloseRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('[data-dialog-open]')) return;
      onCloseRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  // 手机底部抽屉：按住顶部把手下滑超过阈值即收起（移动 / 松开监听挂在 window 上，手指移出把手也能跟随）
  function startDrag(event: React.PointerEvent) {
    event.preventDefault();
    const startY = event.clientY;
    let distance = 0;
    const onMove = (e: PointerEvent) => {
      distance = Math.max(0, e.clientY - startY);
      setDragY(distance);
    };
    const onEnd = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      setDragY(0);
      if (distance > SWIPE_CLOSE_PX) onCloseRef.current();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  }

  return (
    <>
      <div
        className={`panel-backdrop panel-backdrop-${variant}`}
        data-panel-backdrop
        onClick={() => onCloseRef.current()}
        aria-hidden
      />
      <div
        ref={ref}
        className={`panel-surface panel-${variant}`}
        role="dialog"
        aria-modal={variant === 'floating' ? true : undefined}
        aria-label={label}
        style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
      >
        <div className="sheet-handle" onPointerDown={startDrag} aria-hidden>
          <span />
        </div>
        {children}
      </div>
    </>
  );
}
