// 把 supabase/migrations 按文件名顺序合并成一份完整建库脚本（taskapp-full-schema.sql），
// 在全新的 Supabase 项目里一次执行就能建好 TaskApp 的全部表和功能。
// 用法：node supabase/scripts/build-full-schema.mjs（改了迁移之后重新生成；单元测试会检查它是否最新）
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));
const output = fileURLToPath(new URL('./taskapp-full-schema.sql', import.meta.url));

export function buildFullSchema() {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const parts = files.map(
    (name) => `-- ==== ${name} ====\n\n${readFileSync(migrationsDir + name, 'utf8').trimEnd()}\n`,
  );
  return [
    '-- TaskApp 完整建库脚本：由 supabase/migrations 按顺序合并生成，不要手改。',
    '-- 重新生成：node supabase/scripts/build-full-schema.mjs',
    '-- 在全新的 Supabase 项目的 SQL Editor 里一次执行即可（不含本地测试用的时钟替换）。',
    '',
    'begin;',
    '',
    ...parts,
    'commit;',
    '',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(output, buildFullSchema());
  console.log(`已生成 ${output}`);
}
