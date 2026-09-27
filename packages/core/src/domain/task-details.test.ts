import { describe, expect, it } from 'vitest';

import { normalizeLocationDraft, normalizePeopleDrafts } from './task-details';

describe('normalizeLocationDraft', () => {
  it('去除空白；名称和地址都为空表示没有地点', () => {
    expect(normalizeLocationDraft({ name: ' 公司 ', address: '' })).toEqual({
      name: '公司',
      address: '',
    });
    expect(normalizeLocationDraft({ name: '  ', address: '\n' })).toBeNull();
  });
});

describe('normalizePeopleDrafts', () => {
  it('去除空白、忽略空行、保留已有 id', () => {
    expect(
      normalizePeopleDrafts([
        { id: 'p1', name: ' 张三 ', relation: ' 客户 ' },
        { name: '', relation: '' },
        { name: '李四', relation: '' },
      ]),
    ).toEqual({
      ok: true,
      people: [
        { id: 'p1', name: '张三', relation: '客户' },
        { name: '李四', relation: '' },
      ],
    });
  });

  it('只填关系不填姓名是错误', () => {
    expect(
      normalizePeopleDrafts([
        { name: 'a', relation: '' },
        { name: ' ', relation: '同事' },
      ]),
    ).toEqual({
      ok: false,
      error: 'name_required',
      index: 1,
    });
  });
});
