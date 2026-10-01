/**
 * 组：和个人同级的任务容器。组之间什么都不共用（名单、昵称、任务各归各的组）；
 * 组里没有分类，组也不能被归进分类。
 */

/** 组的类型：建组时确定，之后不能改。 */
export type GroupKind = 'cooperative' | 'management' | 'education';

export const GROUP_KIND_LABELS: Record<GroupKind, string> = {
  cooperative: '合作组',
  management: '管理组',
  education: '教育组',
};

/** 组里的身份。合作组里人人都是组长；管理组：组长 / 管理员 / 组员 */
export type GroupRole = 'leader' | 'admin' | 'member';

export const GROUP_ROLE_LABELS: Record<GroupRole, string> = {
  leader: '组长',
  admin: '管理员',
  member: '组员',
};

export interface Group {
  id: string;
  kind: GroupKind;
  name: string;
  /** #RRGGBB；没设时为 null */
  color: string | null;
  createdBy: string;
  createdAt: Date;
  /** 我在这个组里的身份 */
  myRole: GroupRole;
}

/** 名单里的一位成员；nickname 只在本组显示，默认是他的 TaskApp 名字 */
export interface GroupMember {
  userId: string;
  nickname: string;
  /** 是否自己设过昵称（没设过时 nickname 就是他的 TaskApp 名字） */
  hasCustomNickname: boolean;
  isMe: boolean;
  joinedAt: Date;
  role: GroupRole;
  email: string;
}

/** 只有名字的人（不是 TaskApp 用户）：只能出现在 RACI 的 C 和 I 上 */
export interface GroupContact {
  id: string;
  groupId: string;
  name: string;
}

/* ------------------------------------------------------------------ */
/* RACI                                                                 */
/* ------------------------------------------------------------------ */

/**
 * R：负责做，能标记完成；A：能确认完成，也能不通过；C：被咨询；I：被告知（状态或内容有变化时收到通知）。
 * R、A 必须是组内成员；C、I 可以是成员，也可以是只有名字的人。
 */
export type RaciRole = 'R' | 'A' | 'C' | 'I';

export const RACI_ROLES: readonly RaciRole[] = ['R', 'A', 'C', 'I'];

/** 任务上的一个 RACI 字母：指向组内成员（userId）或只有名字的人（contactId），二者有且只有一个 */
export interface TaskAssignment {
  taskId: string;
  role: RaciRole;
  userId: string | null;
  contactId: string | null;
}

/** R、A 只能是组内成员 */
export function raciAllowsContacts(role: RaciRole): boolean {
  return role === 'C' || role === 'I';
}

/* ------------------------------------------------------------------ */
/* 哪种容器用哪些看法、开哪些功能（集中配置在这一处）                     */
/* ------------------------------------------------------------------ */

/** 容器：个人，或某一种组 */
export type ContainerKind = 'personal' | GroupKind;

/** 任务的看法：清单、时间管理矩阵、责任分配矩阵。以后加甘特图就是再加一种 */
export type TaskView = 'list' | 'matrix' | 'raci';

export interface ContainerFeatures {
  /** 建组时能不能选这种类型（个人不适用） */
  creatable: boolean;
  /** 可用的看法，第一个是默认的 */
  views: readonly TaskView[];
  /** 任务字段：重要性、分类、收藏 */
  importance: boolean;
  categories: boolean;
  starred: boolean;
  /** 任务上设定 RACI */
  raci: boolean;
  /** 完成要 A 确认（R 标记完成后进入"待确认"） */
  confirmation: boolean;
  /** 名单里有只有名字的人 */
  contacts: boolean;
  /** 身份分组长 / 管理员 / 组员（否则人人都是组长） */
  roles: boolean;
  /** 被邀请加入的人的身份 */
  inviteeRole: GroupRole;
  /** 能不能退出组 */
  leavable: boolean;
  /** 投票超时（天）：删除组、任命组长；一直不操作算同意 */
  deletionVoteDays: number;
  leaderVoteDays: number | null;
}

export const CONTAINER_FEATURES: Record<ContainerKind, ContainerFeatures> = {
  personal: {
    creatable: false,
    views: ['list', 'matrix'],
    importance: true,
    categories: true,
    starred: true,
    raci: false,
    confirmation: false,
    contacts: false,
    roles: false,
    inviteeRole: 'leader',
    leavable: false,
    deletionVoteDays: 0,
    leaderVoteDays: null,
  },
  cooperative: {
    creatable: true,
    views: ['list'],
    importance: false,
    categories: false,
    starred: false,
    raci: false,
    confirmation: false,
    contacts: false,
    roles: false,
    inviteeRole: 'leader',
    leavable: true,
    deletionVoteDays: 7,
    leaderVoteDays: null,
  },
  management: {
    creatable: true,
    views: ['list', 'raci'],
    importance: false,
    categories: false,
    starred: false,
    raci: true,
    confirmation: true,
    contacts: true,
    roles: true,
    inviteeRole: 'member',
    leavable: true,
    deletionVoteDays: 7,
    leaderVoteDays: 3,
  },
  // 这一批不做：不能新建，已有的（不会有）只读
  education: {
    creatable: false,
    views: ['list'],
    importance: false,
    categories: false,
    starred: false,
    raci: false,
    confirmation: false,
    contacts: false,
    roles: true,
    inviteeRole: 'member',
    leavable: true,
    deletionVoteDays: 7,
    leaderVoteDays: null,
  },
};

export function containerKindOf(group: Pick<Group, 'kind'> | null | undefined): ContainerKind {
  return group ? group.kind : 'personal';
}

export function featuresOf(group: Pick<Group, 'kind'> | null | undefined): ContainerFeatures {
  return CONTAINER_FEATURES[containerKindOf(group)];
}

/** 建组时可选的类型 */
export const CREATABLE_GROUP_KINDS: readonly GroupKind[] = (
  Object.keys(GROUP_KIND_LABELS) as GroupKind[]
).filter((kind) => CONTAINER_FEATURES[kind].creatable);

/* ------------------------------------------------------------------ */
/* 身份与权限（数据库里按同样的规则生效，这里决定界面上显示哪些操作）     */
/* ------------------------------------------------------------------ */

/** 一个人在组里能做的管理操作 */
export interface GroupPermissions {
  /** 改组名和颜色 */
  editGroup: boolean;
  /** 发起删除组、参与删除组和任命组长的投票 */
  deleteGroup: boolean;
  /** 建任务、编辑任务（含 RACI）、删任务 */
  manageTasks: boolean;
  invite: boolean;
  /** 添加和删除只有名字的人 */
  manageContacts: boolean;
}

export function groupPermissions(kind: GroupKind, role: GroupRole | null): GroupPermissions {
  const features = CONTAINER_FEATURES[kind];
  if (role === null || !features.creatable) {
    return {
      editGroup: false,
      deleteGroup: false,
      manageTasks: false,
      invite: false,
      manageContacts: false,
    };
  }
  const leader = role === 'leader';
  const manager = leader || role === 'admin';
  return {
    editGroup: leader,
    deleteGroup: leader,
    manageTasks: manager,
    invite: manager,
    manageContacts: features.contacts && manager,
  };
}

/** 名单里对另一位成员能做的操作（管理组） */
export interface MemberActions {
  appointAdmin: boolean;
  revokeAdmin: boolean;
  appointLeader: boolean;
  /** 踢出 */
  remove: boolean;
}

export function memberActions(
  kind: GroupKind,
  actorRole: GroupRole | null,
  target: Pick<GroupMember, 'role' | 'isMe'>,
): MemberActions {
  const none = { appointAdmin: false, revokeAdmin: false, appointLeader: false, remove: false };
  if (!CONTAINER_FEATURES[kind].roles || !CONTAINER_FEATURES[kind].creatable || target.isMe) {
    return none;
  }
  if (actorRole === 'leader') {
    return {
      appointAdmin: target.role === 'member',
      revokeAdmin: target.role === 'admin',
      appointLeader: target.role !== 'leader',
      remove: target.role !== 'leader',
    };
  }
  if (actorRole === 'admin') return { ...none, remove: target.role === 'member' };
  return none;
}

/** 某个人在某条任务上能做什么 */
export interface TaskPermissions {
  /** 编辑内容（含 RACI）、删除 */
  edit: boolean;
  /** 标记完成（R） */
  complete: boolean;
  /** 确认完成 / 不通过（A） */
  confirm: boolean;
  /** 取消完成（R 或 A） */
  uncomplete: boolean;
}

/**
 * 个人和合作组：什么都能做（合作组里人人对每条任务都是 R 和 A，标记完成就算确认完成）。
 * 管理组：内容由组长、管理员编辑；R 标记完成，A 确认或不通过。
 */
export function taskPermissions(
  kind: ContainerKind,
  role: GroupRole | null,
  myRaci: readonly RaciRole[],
): TaskPermissions {
  if (kind === 'personal' || !CONTAINER_FEATURES[kind].raci) {
    const member = kind === 'personal' || role !== null;
    return { edit: member, complete: member, confirm: false, uncomplete: member };
  }
  const isR = myRaci.includes('R');
  const isA = myRaci.includes('A');
  return {
    edit: role === 'leader' || role === 'admin',
    complete: isR,
    confirm: isA,
    uncomplete: isR || isA,
  };
}

/** 删除组的投票：一周内没有操作的组长算作同意 */
export const GROUP_DELETION_VOTE_DAYS = CONTAINER_FEATURES.cooperative.deletionVoteDays;
