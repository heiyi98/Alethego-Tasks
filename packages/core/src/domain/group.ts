/**
 * 组：和个人同级的任务容器。组之间什么都不共用（名单、昵称、任务各归各的组）；
 * 组里没有分类，组也不能被归进分类。
 */

/** 组的类型：建组时确定，之后不能改。目前只做合作组。 */
export type GroupKind = 'cooperative' | 'management' | 'education';

export const GROUP_KIND_LABELS: Record<GroupKind, string> = {
  cooperative: '合作组',
  management: '管理组',
  education: '教育组',
};

export interface Group {
  id: string;
  kind: GroupKind;
  name: string;
  createdBy: string;
  createdAt: Date;
}

/** 名单里的一位成员；nickname 只在本组显示，默认是他的 TaskApp 名字 */
export interface GroupMember {
  userId: string;
  nickname: string;
  /** 是否自己设过昵称（没设过时 nickname 就是他的 TaskApp 名字） */
  hasCustomNickname: boolean;
  isMe: boolean;
  joinedAt: Date;
}

/**
 * 一个成员在组里能做什么：
 * - 组长：建任务、删任务，并拥有 R 与 A
 * - R：标记完成；A：确认完成、编辑任务内容
 * 同一个人既是 R 又是 A 时，他标记完成就算确认完成。
 */
export interface GroupCapabilities {
  isLeader: boolean;
  /** R：标记完成 */
  canMarkComplete: boolean;
  /** A：确认完成、编辑任务内容 */
  canApprove: boolean;
  canCreateTasks: boolean;
  canDeleteTasks: boolean;
}

/**
 * 按组的类型在后台生效，不给每条任务逐个写角色。
 * 合作组：所有成员都是组长，对每条任务都是 R 和 A。
 */
export function groupCapabilities(kind: GroupKind): GroupCapabilities {
  switch (kind) {
    case 'cooperative':
      return {
        isLeader: true,
        canMarkComplete: true,
        canApprove: true,
        canCreateTasks: true,
        canDeleteTasks: true,
      };
    case 'management':
    case 'education':
      // 这一批不做；保守起见只读
      return {
        isLeader: false,
        canMarkComplete: false,
        canApprove: false,
        canCreateTasks: false,
        canDeleteTasks: false,
      };
  }
}

/** 标记完成是否同时算确认完成（同一个人既是 R 又是 A） */
export function completionIsApproved(capabilities: GroupCapabilities): boolean {
  return capabilities.canMarkComplete && capabilities.canApprove;
}

/** 删除组的投票：一周内没有操作的组长算作同意 */
export const GROUP_DELETION_VOTE_DAYS = 7;
