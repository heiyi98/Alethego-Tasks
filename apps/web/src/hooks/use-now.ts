'use client';

import { useEffect, useState } from 'react';

/** 当前时间，每分钟刷新一次（"已错过"等派生状态随时间变化）。 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
