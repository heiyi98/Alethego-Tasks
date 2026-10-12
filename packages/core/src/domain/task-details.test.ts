import { describe, expect, it } from 'vitest';

import { normalizePeopleDrafts } from './task-details';

describe('normalizePeopleDrafts', () => {
  it('去除空白、忽略空行、保留已有 id', () => {
    expect(
      normalizePeopleDrafts([
        { id: 'p1', name: ' 张三 ', note: ' 客户 ' },
        { name: '', note: '' },
        { name: '李四', note: '' },
      ]),
    ).toEqual({
      ok: true,
      people: [
        { id: 'p1', name: '张三', note: '客户' },
        { name: '李四', note: '' },
      ],
    });
  });

  it('只填备注不填姓名是错误', () => {
    expect(
      normalizePeopleDrafts([
        { name: 'a', note: '' },
        { name: ' ', note: '同事' },
      ]),
    ).toEqual({
      ok: false,
      error: 'name_required',
      index: 1,
    });
  });
});
