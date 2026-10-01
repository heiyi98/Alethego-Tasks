import { describe, expect, it } from 'vitest';

import {
  CONTAINER_FEATURES,
  CREATABLE_GROUP_KINDS,
  groupPermissions,
  memberActions,
  taskPermissions,
} from './group';

describe('哪种容器开哪些功能', () => {
  it('建组时只能选合作组和管理组', () => {
    expect(CREATABLE_GROUP_KINDS).toEqual(['cooperative', 'management']);
  });

  it('看法：个人有清单和矩阵，合作组只有清单，管理组有清单和责任分配矩阵', () => {
    expect(CONTAINER_FEATURES.personal.views).toEqual(['list', 'matrix']);
    expect(CONTAINER_FEATURES.cooperative.views).toEqual(['list']);
    expect(CONTAINER_FEATURES.management.views).toEqual(['list', 'raci']);
  });

  it('只有管理组有 RACI、待确认、只有名字的人；被邀请的人是组员', () => {
    expect(CONTAINER_FEATURES.management).toMatchObject({
      raci: true,
      confirmation: true,
      contacts: true,
      inviteeRole: 'member',
      leaderVoteDays: 3,
    });
    expect(CONTAINER_FEATURES.cooperative).toMatchObject({
      raci: false,
      confirmation: false,
      inviteeRole: 'leader',
    });
  });
});

describe('身份与权限', () => {
  it('合作组：人人都是组长，什么都能做', () => {
    expect(groupPermissions('cooperative', 'leader')).toEqual({
      editGroup: true,
      deleteGroup: true,
      manageTasks: true,
      invite: true,
      manageContacts: false,
    });
    expect(taskPermissions('cooperative', 'leader', [])).toEqual({
      edit: true,
      complete: true,
      confirm: false,
      uncomplete: true,
    });
  });

  it('管理组：组长、管理员管任务和邀请；组员只能做 RACI 允许的事', () => {
    expect(groupPermissions('management', 'admin')).toEqual({
      editGroup: false,
      deleteGroup: false,
      manageTasks: true,
      invite: true,
      manageContacts: true,
    });
    expect(groupPermissions('management', 'member').manageTasks).toBe(false);
    expect(taskPermissions('management', 'member', ['R'])).toEqual({
      edit: false,
      complete: true,
      confirm: false,
      uncomplete: true,
    });
    expect(taskPermissions('management', 'admin', ['A']).complete).toBe(false);
    expect(taskPermissions('management', 'member', ['A']).confirm).toBe(true);
  });

  it('名单里的操作：组长任命 / 撤销管理员、任命组长、踢出非组长；管理员只能踢组员', () => {
    const member = { role: 'member', isMe: false } as const;
    const admin = { role: 'admin', isMe: false } as const;
    const leader = { role: 'leader', isMe: false } as const;
    expect(memberActions('management', 'leader', member)).toEqual({
      appointAdmin: true,
      revokeAdmin: false,
      appointLeader: true,
      remove: true,
    });
    expect(memberActions('management', 'leader', admin)).toMatchObject({
      revokeAdmin: true,
      appointAdmin: false,
    });
    expect(Object.values(memberActions('management', 'leader', leader))).not.toContain(true);
    expect(memberActions('management', 'admin', member).remove).toBe(true);
    expect(memberActions('management', 'admin', admin).remove).toBe(false);
    expect(Object.values(memberActions('management', 'member', member))).not.toContain(true);
    expect(Object.values(memberActions('cooperative', 'leader', leader))).not.toContain(true);
  });
});
