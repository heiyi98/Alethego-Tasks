import { describe, expect, it } from 'vitest';

import { completionIsApproved, groupCapabilities } from './group';

describe('组里的权限按组的类型生效', () => {
  it('合作组：所有成员都是组长，对每条任务都是 R 和 A；标记完成就算确认完成', () => {
    const caps = groupCapabilities('cooperative');
    expect(caps).toEqual({
      isLeader: true,
      canMarkComplete: true,
      canApprove: true,
      canCreateTasks: true,
      canDeleteTasks: true,
    });
    expect(completionIsApproved(caps)).toBe(true);
  });

  it('还没做的类型不给任何权限', () => {
    expect(groupCapabilities('management').canCreateTasks).toBe(false);
    expect(completionIsApproved(groupCapabilities('education'))).toBe(false);
  });
});
