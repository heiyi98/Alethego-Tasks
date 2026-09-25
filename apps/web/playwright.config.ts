import { defineConfig, devices } from '@playwright/test';

/**
 * 端到端测试：驱动真实页面读写 Supabase。
 * 运行前需在 .env.local 中配置 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY，
 * 并已应用 supabase/migrations（本地可用 `supabase start && supabase db reset`）。
 * 用例用随机前缀隔离数据，不需要清库。
 */
// 用例中直接查询数据库时需要同一组 Supabase 配置
try {
  process.loadEnvFile('.env.local');
} catch {
  // 未提供 .env.local 时使用进程环境变量
}

const port = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    timezoneId: 'Asia/Shanghai',
    locale: 'zh-CN',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm build && pnpm start -p ${port}`,
    port,
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
