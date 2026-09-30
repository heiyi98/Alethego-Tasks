import { defineConfig, devices } from '@playwright/test';

/**
 * 端到端测试：驱动真实页面读写 Supabase。
 * 运行前需在 .env.local 中配置本地环境（不要连真实项目）：
 * - NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY：本地数据项目，已应用 supabase/migrations
 * - NEXT_PUBLIC_ALETHEGO_URL / NEXT_PUBLIC_ALETHEGO_PUBLISHABLE_KEY：本地 Supabase Auth（模拟 Alethego），
 *   邮箱自动确认；它签发令牌用的 JWT 密钥要与本地数据项目验证令牌的密钥一致（模拟第三方认证）
 * 每次运行注册一个新的主测试账号；用例用随机前缀隔离数据，不需要清库。
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
  // 先注册主测试账号并保存登录状态（见 e2e/global-setup.ts）
  globalSetup: './e2e/global-setup.ts',
  use: {
    storageState: './e2e/.auth/state.json',
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
