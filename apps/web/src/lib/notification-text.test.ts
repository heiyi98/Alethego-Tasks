import type { GroupNotification } from '@alethego/data';
import { describe, expect, it } from 'vitest';

import { zh } from '@/i18n/zh';
import { notificationText } from './notification-text';

const base: GroupNotification = {
  kind: 'task',
  id: 'n',
  groupId: 'g',
  groupName: '小组',
  projectId: 'p',
  projectName: '项目一',
  actorName: '甲',
  createdAt: new Date(),
  taskId: 't',
  taskTitle: '任务一',
  subjectName: null,
  subjectIsMe: false,
  action: 'assigned',
  fields: [],
  canConfirm: false,
  taskDeleted: false,
};
const text = (patch: Partial<GroupNotification>) => notificationText({ ...base, ...patch }, zh);

describe('通知拼成一句话', () => {
  it('设为执行人：对象是自己时说"你"', () => {
    expect(text({ subjectIsMe: true, subjectName: '乙' })).toBe('甲把你设为任务一的执行人（R）');
    expect(text({ subjectName: '乙' })).toBe('甲把乙设为任务一的执行人（R）');
  });

  it('完成、确认、退回', () => {
    expect(text({ action: 'completed' })).toBe('甲完成了任务一');
    expect(text({ action: 'confirmed', actorName: '丙' })).toBe('丙确认了任务一');
    expect(text({ action: 'rejected', actorName: '丙' })).toBe('丙退回了任务一');
  });

  it('修改：列出改动的字段', () => {
    const modified = { action: 'modified' as const, actorName: '乙', taskTitle: '任务二' };
    expect(text({ ...modified, fields: ['description'] })).toBe('乙修改了任务二的描述');
    expect(text({ ...modified, fields: ['deadline', 'A'] })).toBe(
      '乙修改了任务二的截止时间和负责人（A）',
    );
    expect(text({ ...modified, fields: ['title', 'description', 'people'] })).toBe(
      '乙修改了任务二的标题、描述和人物',
    );
    expect(text({ ...modified, fields: ['description', 'deleted'] })).toBe('乙删除了任务二');
  });

  it('组的通知', () => {
    expect(text({ kind: 'group_invitation', action: null })).toBe('甲邀请你加入「小组」');
    expect(text({ kind: 'group_leader_vote', action: null, subjectName: '乙' })).toBe(
      '甲提议任命乙为「小组」的组长',
    );
  });

  it('项目的通知', () => {
    expect(text({ kind: 'project_invitation', action: null })).toBe(
      '甲邀请你加入「小组」的「项目一」',
    );
    expect(text({ kind: 'project_deletion_vote', action: null })).toBe(
      '甲发起删除「小组」的「项目一」',
    );
  });
});
