import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    // 只跑不依赖浏览器的纯逻辑；页面行为由 e2e/ 中的 Playwright 用例覆盖
    include: ['src/**/*.test.ts'],
    env: { TZ: 'Asia/Shanghai' },
  },
});
