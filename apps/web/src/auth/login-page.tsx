'use client';

import { useState, type FormEvent } from 'react';

export interface LoginActions {
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (
    email: string,
    password: string,
  ) => Promise<{ error?: string; needsConfirmation?: boolean }>;
  signInWithGoogle: () => Promise<{ error?: string }>;
}

/**
 * 登录页：没登录时只显示这一页。两种方式：邮箱密码（登录 / 注册）、Google 登录。
 * "添加账号"时也用这一页，多一个取消，回到当前账号。
 */
export function LoginPage({ actions, onCancel }: { actions: LoginActions; onCancel?: () => void }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmSent, setConfirmSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setConfirmSent(false);
    const result =
      mode === 'signin'
        ? await actions.signIn(email.trim(), password)
        : await actions.signUp(email.trim(), password);
    setBusy(false);
    if (result.error) setError(result.error);
    else if ('needsConfirmation' in result && result.needsConfirmation) setConfirmSent(true);
  }

  async function google() {
    setError(null);
    const result = await actions.signInWithGoogle();
    if (result.error) setError(result.error);
  }

  const label = mode === 'signin' ? '登录' : '注册';

  return (
    <main className="login-page">
      <div className="login-card">
        <h1 className="login-brand">Alethego</h1>

        <div className="segmented-control login-mode" role="group" aria-label="登录或注册">
          {(['signin', 'signup'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => {
                setMode(m);
                setError(null);
                setConfirmSent(false);
              }}
            >
              {m === 'signin' ? '登录' : '注册'}
            </button>
          ))}
        </div>

        <form className="login-form" aria-label={label} onSubmit={submit}>
          <label className="login-field">
            <span>邮箱</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="login-field">
            <span>密码</span>
            <input
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          {confirmSent && <p className="login-notice">请到邮箱确认后再登录</p>}
          <button type="submit" className="button-primary login-submit" disabled={busy}>
            {label}
          </button>
        </form>

        <button type="button" className="login-google" onClick={google}>
          使用 Google 登录
        </button>

        {onCancel && (
          <button type="button" className="button-link login-cancel" onClick={onCancel}>
            取消
          </button>
        )}
      </div>
    </main>
  );
}
