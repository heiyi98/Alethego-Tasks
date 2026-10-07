'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { IconButton, UndoIcon, WarningIcon, XIcon, CheckIcon } from './icons';

/**
 * 全局反馈：
 * - 撤销提示条：不可逆动作（删除任务 / 删除人物 / 清空描述）执行后短暂显示，点撤销即恢复
 * - 确认框：以图标为主；离开未保存的修改时用文字按钮（放弃修改 / 继续编辑）
 */

const TOAST_MS = 5000;

interface Toast {
  id: number;
  message: string;
  onUndo?: () => void | Promise<void>;
}

interface ConfirmRequest {
  message: string;
  /** 说明或列表（例如踢出某人前列出他身上的 C、I） */
  detail?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  /** 只有一个关闭按钮（操作不能执行时告诉用户原因） */
  alertOnly?: boolean;
  /** 两个按钮直接写字（例如"放弃修改 / 继续编辑"），不用图标 */
  textButtons?: boolean;
  resolve: (ok: boolean) => void;
}

interface FeedbackValue {
  showUndo: (message: string, onUndo: () => void | Promise<void>) => void;
  /** 没有撤销的提示（例如创建失败） */
  notify: (message: string) => void;
  confirm: (options: Omit<ConfirmRequest, 'resolve'>) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackValue | null>(null);

let toastSeq = 0;

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.filter((t) => t.id !== id));
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);

  const push = useCallback(
    (message: string, onUndo?: () => void | Promise<void>) => {
      const id = ++toastSeq;
      setToasts((all) => [...all.slice(-2), { id, message, onUndo }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), TOAST_MS),
      );
    },
    [dismiss],
  );
  const showUndo = useCallback(
    (message: string, onUndo: () => void | Promise<void>) => push(message, onUndo),
    [push],
  );
  const notify = useCallback((message: string) => push(message), [push]);

  const confirm = useCallback(
    (options: Omit<ConfirmRequest, 'resolve'>) =>
      new Promise<boolean>((resolve) => setRequest({ ...options, resolve })),
    [],
  );

  const answer = useCallback(
    (ok: boolean) => {
      request?.resolve(ok);
      setRequest(null);
    },
    [request],
  );

  useEffect(() => {
    if (!request) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        answer(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [request, answer]);

  return (
    <FeedbackContext.Provider value={{ showUndo, notify, confirm }}>
      {children}

      <div className="toast-stack" data-keep-panel aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast" role="status">
            <span className="toast-message">{toast.message}</span>
            {toast.onUndo && (
              <IconButton
                label="撤销"
                className="toast-undo"
                onClick={async () => {
                  dismiss(toast.id);
                  await toast.onUndo?.();
                }}
              >
                <UndoIcon />
              </IconButton>
            )}
            <IconButton label="关闭提示" className="toast-close" onClick={() => dismiss(toast.id)}>
              <XIcon size={14} />
            </IconButton>
          </div>
        ))}
      </div>

      {request && (
        <div className="dialog-backdrop" data-keep-panel data-dialog-open>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-label={request.message}>
            <span className={`dialog-icon${request.destructive ? ' dialog-icon-danger' : ''}`}>
              <WarningIcon size={28} />
            </span>
            <p className="dialog-message">{request.message}</p>
            {request.detail &&
              (typeof request.detail === 'string' ? (
                <p className="dialog-detail">{request.detail}</p>
              ) : (
                <div className="dialog-detail">{request.detail}</div>
              ))}
            {request.textButtons ? (
              <div className="dialog-actions dialog-actions-text">
                <button
                  type="button"
                  className={request.destructive ? 'button-danger' : 'button-primary'}
                  onClick={() => answer(true)}
                >
                  {request.confirmLabel}
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  autoFocus
                  onClick={() => answer(false)}
                >
                  {request.cancelLabel}
                </button>
              </div>
            ) : (
              <div className="dialog-actions">
                <IconButton
                  label={request.cancelLabel}
                  className="dialog-button"
                  autoFocus
                  onClick={() => answer(false)}
                >
                  <XIcon />
                </IconButton>
                {!request.alertOnly && (
                  <IconButton
                    label={request.confirmLabel}
                    className={`dialog-button${request.destructive ? ' dialog-button-danger' : ' dialog-button-primary'}`}
                    onClick={() => answer(true)}
                  >
                    <CheckIcon />
                  </IconButton>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackValue {
  const value = useContext(FeedbackContext);
  if (!value) throw new Error('useFeedback 必须在 FeedbackProvider 内使用');
  return value;
}
