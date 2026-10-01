import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildFullSchema } from '../../../../supabase/scripts/build-full-schema.mjs';

describe('迁库准备', () => {
  it('合并好的完整建库脚本与 supabase/migrations 一致（改了迁移要重新生成）', () => {
    const current = readFileSync(
      new URL('../../../../supabase/scripts/taskapp-full-schema.sql', import.meta.url),
      'utf8',
    );
    expect(current).toBe(buildFullSchema());
  });
});
