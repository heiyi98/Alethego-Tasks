import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // 固定进程时区为一个非 UTC 值，确保核心逻辑不依赖运行环境的系统时区
    env: { TZ: 'America/Los_Angeles' },
  },
});
