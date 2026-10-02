import { describe, expect, it } from 'vitest';

import {
  CREATABLE_GROUP_KINDS,
  GROUP_KIND_CONFIG,
  featuresForGroupPage,
  featuresForProject,
  groupMemberActions,
  groupPermissions,
  projectMemberActions,
  projectPermissions,
  taskPermissions,
} from './group';

describe('哪种组、哪些工具开哪些功能', () => {
  it('建组时只能选合作组和管理组', () => {
    expect(CREATABLE_GROUP_KINDS).toEqual(['cooperative', 'management']);
  });

  it('两种组只在身份结构上不同', () => {
    expect(GROUP_KIND_CONFIG.cooperative).toMatchObject({
      everyoneLeader: true,
      inviteeRole: 'leader',
      projectOnlyRole: 'admin',
    });
    expect(GROUP_KIND_CONFIG.management).toMatchObject({
      everyoneLeader: false,
      inviteeRole: 'member',
      projectAdmins: true,
      leaderVoteDays: 3,
    });
  });

  it('个人有清单和矩阵；项目开了任务分配才有 RACI、待确认、只有名字的人、通知、责任分配矩阵', () => {
    expect(featuresForProject(null).views).toEqual(['list', 'matrix']);
    expect(featuresForProject({ tools: [] })).toMatchObject({
      views: ['list'],
      raci: false,
      confirmation: false,
      notifications: false,
    });
    expect(featuresForProject({ tools: ['relations'] }).raci).toBe(false);
    expect(featuresForProject({ tools: ['assignment', 'relations'] })).toMatchObject({
      views: ['list', 'raci'],
      raci: true,
      confirmation: true,
      contacts: true,
      notifications: true,
    });
  });

  it('组页面只有清单；有一个项目开了任务分配就有待确认', () => {
    expect(featuresForGroupPage([{ tools: [] }, { tools: ['assignment'] }])).toMatchObject({
      views: ['list'],
      confirmation: true,
    });
    expect(featuresForGroupPage([{ tools: ['relations'] }]).confirmation).toBe(false);
  });
});

describe('身份与权限', () => {
  it('组长：建项目、邀请、改组、删组；只在项目里的人看不到组名单', () => {
    expect(groupPermissions('management', 'leader')).toEqual({
      editGroup: true,
      deleteGroup: true,
      manageProjects: true,
      invite: true,
      viewRoster: true,
    });
    expect(groupPermissions('management', 'member').manageProjects).toBe(false);
    expect(groupPermissions('management', null).viewRoster).toBe(false);
  });

  it('组名单：组长任命组长、踢出组员；合作组里没有', () => {
    const member = { role: 'member', isMe: false } as const;
    expect(groupMemberActions('management', 'leader', member)).toEqual({
      appointLeader: true,
      remove: true,
    });
    expect(groupMemberActions('management', 'member', member).remove).toBe(false);
    expect(
      groupMemberActions('cooperative', 'leader', { role: 'leader', isMe: false }).remove,
    ).toBe(false);
  });

  it('项目：管理员管任务和项目名单；组长还能改项目、不能退出项目', () => {
    expect(projectPermissions('management', { tools: ['assignment'], myRole: 'admin' })).toEqual({
      editProject: false,
      manageTasks: true,
      manageMembers: true,
      manageContacts: true,
      leave: true,
    });
    expect(projectPermissions('management', { tools: [], myRole: 'leader' })).toMatchObject({
      editProject: true,
      manageContacts: false,
      leave: false,
    });
    expect(projectPermissions('management', { tools: [], myRole: 'member' }).manageTasks).toBe(
      false,
    );
  });

  it('项目名单：组长任命 / 撤销管理员（管理组）、移出；管理员只能移出组员；组长不能被移出', () => {
    const member = { role: 'member', isMe: false } as const;
    const admin = { role: 'admin', isMe: false } as const;
    const leader = { role: 'leader', isMe: false } as const;
    expect(projectMemberActions('management', 'leader', member)).toEqual({
      appointAdmin: true,
      revokeAdmin: false,
      remove: true,
    });
    expect(projectMemberActions('management', 'leader', admin)).toMatchObject({
      revokeAdmin: true,
      remove: true,
    });
    expect(projectMemberActions('cooperative', 'leader', admin).revokeAdmin).toBe(false);
    expect(Object.values(projectMemberActions('management', 'leader', leader))).not.toContain(true);
    expect(projectMemberActions('management', 'admin', member).remove).toBe(true);
    expect(projectMemberActions('management', 'admin', admin).remove).toBe(false);
    expect(Object.values(projectMemberActions('management', 'member', member))).not.toContain(true);
  });

  it('任务：没开任务分配时项目成员都能标记完成；开了时按 RACI', () => {
    expect(taskPermissions(null, [])).toMatchObject({ edit: true, complete: true });
    expect(taskPermissions({ tools: [], myRole: 'member' }, [])).toEqual({
      edit: false,
      complete: true,
      confirm: false,
      uncomplete: true,
    });
    expect(taskPermissions({ tools: ['assignment'], myRole: 'member' }, ['R'])).toEqual({
      edit: false,
      complete: true,
      confirm: false,
      uncomplete: true,
    });
    expect(taskPermissions({ tools: ['assignment'], myRole: 'admin' }, ['A'])).toMatchObject({
      edit: true,
      complete: false,
      confirm: true,
    });
  });
});
