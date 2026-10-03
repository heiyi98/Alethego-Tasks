/**
 * 组：和个人同级的任务容器，组里是一个个项目。组任务必须属于某一个项目。
 * 组之间什么都不共用（名单、昵称、项目、任务各归各的组）；组里没有分类，组也不能被归进分类。
 */

/** 组的类型：建组时确定，之后不能改。两种组只在身份结构上不同 */
export type GroupKind = 'cooperative' | 'management' | 'education';

export const GROUP_KIND_LABELS: Record<GroupKind, string> = {
  cooperative: '合作组',
  management: '管理组',
  education: '教育组',
};

/** 组里的身份：组长 / 组员（合作组里人人都是组长） */
export type GroupRole = 'leader' | 'member';

/** 项目里的身份：组长（自动在每个项目里）/ 管理员（只在被任命的项目里）/ 组员 */
export type ProjectRole = 'leader' | 'admin' | 'member';

export const ROLE_LABELS: Record<ProjectRole, string> = {
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
  /** 我在这个组里的身份；null = 不在组里，只在组里的某些项目里 */
  myRole: GroupRole | null;
}

/** 组名单里的一位成员；nickname 只在本组显示，默认是他的 TaskApp 名字 */
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

/* ------------------------------------------------------------------ */
/* 工具箱                                                               */
/* ------------------------------------------------------------------ */

/** 工具：建项目（或个人分类）时选，可多选也可不选，之后不能改 */
export type ProjectTool = 'assignment' | 'relations';

export const TOOL_LABELS: Record<ProjectTool, string> = {
  assignment: '任务分配',
  relations: '任务关系',
};

/** 项目的工具箱里可选的工具 */
export const PROJECT_TOOLS: readonly ProjectTool[] = ['assignment', 'relations'];
/** 个人分类的工具箱里可选的工具 */
export const CATEGORY_TOOLS: readonly ProjectTool[] = ['relations'];

/** 组里的项目：名字、颜色（与分类同一套调色板，可以重复）、工具箱 */
export interface Project {
  id: string;
  groupId: string;
  name: string;
  /** #RRGGBB */
  color: string;
  tools: ProjectTool[];
  createdBy: string;
  createdAt: Date;
  /** 我在这个项目里的身份（合作组里不是组长的人在项目里是管理员） */
  myRole: ProjectRole;
}

/** 项目名单里的一位成员 */
export interface ProjectMember {
  userId: string;
  /** 在这个组里的名字（只在项目里的人：他的 TaskApp 名字） */
  nickname: string;
  isMe: boolean;
  role: ProjectRole;
  email: string;
  /** 是不是组里的人（否则只在项目里） */
  inGroup: boolean;
  joinedAt: Date;
}

/** 只有名字的人（不是 TaskApp 用户）：属于某一个项目，只能出现在 RACI 的 C 和 I 上 */
export interface ProjectContact {
  id: string;
  projectId: string;
  name: string;
}

/* ------------------------------------------------------------------ */
/* RACI                                                                 */
/* ------------------------------------------------------------------ */

/**
 * R：负责做，能标记完成；A：能确认完成，也能不通过；C：被咨询；I：被告知（状态或内容有变化时收到通知）。
 * R、A 必须是项目成员；C、I 可以是成员，也可以是只有名字的人。
 */
export type RaciRole = 'R' | 'A' | 'C' | 'I';

export const RACI_ROLES: readonly RaciRole[] = ['R', 'A', 'C', 'I'];

/** 任务上的一个 RACI 字母：指向项目成员（userId）或只有名字的人（contactId），二者有且只有一个 */
export interface TaskAssignment {
  taskId: string;
  role: RaciRole;
  userId: string | null;
  contactId: string | null;
}

/** R、A 只能是项目成员 */
export function raciAllowsContacts(role: RaciRole): boolean {
  return role === 'C' || role === 'I';
}

/* ------------------------------------------------------------------ */
/* 哪种组、哪些工具开哪些功能（集中配置在这一处）                         */
/* ------------------------------------------------------------------ */

/** 任务的看法：清单、时间管理矩阵、责任分配矩阵、甘特图 */
export type TaskView = 'list' | 'matrix' | 'raci' | 'gantt';

/** 一个容器（个人，或某个项目）里的任务开哪些功能 */
export interface ContainerFeatures {
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
  /** 项目名单里有只有名字的人 */
  contacts: boolean;
  /** 任务通知 */
  notifications: boolean;
  /** 任务关系：开始 / 结束两行逻辑、等待、甘特图 */
  relations: boolean;
}

export const PERSONAL_FEATURES: ContainerFeatures = {
  views: ['list', 'matrix'],
  importance: true,
  categories: true,
  starred: true,
  raci: false,
  confirmation: false,
  contacts: false,
  notifications: false,
  relations: false,
};

/** 没开任何工具的项目：只有清单，项目成员都能标记完成，完成即确认 */
const BASE_PROJECT_FEATURES: ContainerFeatures = {
  views: ['list'],
  importance: false,
  categories: false,
  starred: false,
  raci: false,
  confirmation: false,
  contacts: false,
  notifications: false,
  relations: false,
};

/** 每个工具打开的功能 */
export const TOOL_FEATURES: Record<ProjectTool, Partial<ContainerFeatures>> = {
  assignment: {
    views: ['raci'],
    raci: true,
    confirmation: true,
    contacts: true,
    notifications: true,
  },
  relations: {
    views: ['gantt'],
    relations: true,
  },
};

/** 组的类型决定的身份结构 */
export interface GroupKindConfig {
  /** 建组时能不能选这种类型 */
  creatable: boolean;
  /** 人人都是组长（因此在每个项目里都是管理员） */
  everyoneLeader: boolean;
  /** 被邀请进组的人的身份 */
  inviteeRole: GroupRole;
  /** 只在项目里的人在项目里的身份（合作组：管理员） */
  projectOnlyRole: ProjectRole;
  /** 组长能在项目里任命 / 撤销管理员 */
  projectAdmins: boolean;
  /** 投票超时（天）：删除组和删除项目、任命组长；一直不操作算同意 */
  deletionVoteDays: number;
  leaderVoteDays: number | null;
}

export const GROUP_KIND_CONFIG: Record<GroupKind, GroupKindConfig> = {
  cooperative: {
    creatable: true,
    everyoneLeader: true,
    inviteeRole: 'leader',
    projectOnlyRole: 'admin',
    projectAdmins: false,
    deletionVoteDays: 7,
    leaderVoteDays: null,
  },
  management: {
    creatable: true,
    everyoneLeader: false,
    inviteeRole: 'member',
    projectOnlyRole: 'member',
    projectAdmins: true,
    deletionVoteDays: 7,
    leaderVoteDays: 3,
  },
  // 这一批不做：不能新建
  education: {
    creatable: false,
    everyoneLeader: false,
    inviteeRole: 'member',
    projectOnlyRole: 'member',
    projectAdmins: true,
    deletionVoteDays: 7,
    leaderVoteDays: null,
  },
};

/** 按工具箱合成功能 */
export function featuresForTools(tools: readonly ProjectTool[]): ContainerFeatures {
  const features = { ...BASE_PROJECT_FEATURES };
  for (const tool of tools) {
    const extra = TOOL_FEATURES[tool];
    for (const key of Object.keys(extra) as (keyof ContainerFeatures)[]) {
      if (key === 'views') {
        features.views = [...new Set([...features.views, ...(extra.views ?? [])])];
      } else if (extra[key]) {
        features[key] = true;
      }
    }
  }
  return features;
}

/** 个人（null）或某个项目的功能 */
export function featuresForProject(
  project: Pick<Project, 'tools'> | null | undefined,
): ContainerFeatures {
  return project ? featuresForTools(project.tools) : PERSONAL_FEATURES;
}

/**
 * 个人页面：只选中一个分类、且这个分类开了"任务关系"时，多一个甘特图（和清单切换）
 */
export function featuresForCategoryPage(
  categories: readonly { tools: readonly ProjectTool[] }[],
): ContainerFeatures {
  if (categories.length === 1 && categories[0]!.tools.includes('relations')) {
    return { ...PERSONAL_FEATURES, views: [...PERSONAL_FEATURES.views, 'gantt'], relations: true };
  }
  return PERSONAL_FEATURES;
}

/**
 * 一条任务有没有"任务关系"（开始 / 结束两行逻辑、等待）：
 * 组任务看它的项目开没开；个人任务只要挂了至少一个开了"任务关系"的分类。循环任务没有
 */
export function taskHasRelations(
  task: { recurrenceRule: string | null; projectId: string | null },
  project: Pick<Project, 'tools'> | null | undefined,
  categories: readonly { tools: readonly ProjectTool[] }[],
): boolean {
  if (task.recurrenceRule) return false;
  if (task.projectId) return Boolean(project?.tools.includes('relations'));
  return categories.some((c) => c.tools.includes('relations'));
}

/**
 * 点组时的页面：列出我能看到的所有项目的任务，只有清单；
 * 只要有一个项目开了任务分配，状态行就有"待确认"。
 */
export function featuresForGroupPage(
  projects: readonly Pick<Project, 'tools'>[],
): ContainerFeatures {
  // 组页面只有清单（甘特图、责任分配矩阵在项目页面）
  const merged = featuresForTools([...new Set(projects.flatMap((p) => p.tools))]);
  return { ...merged, views: ['list'] };
}

/** 建组时可选的类型 */
export const CREATABLE_GROUP_KINDS: readonly GroupKind[] = (
  Object.keys(GROUP_KIND_LABELS) as GroupKind[]
).filter((kind) => GROUP_KIND_CONFIG[kind].creatable);

/* ------------------------------------------------------------------ */
/* 身份与权限（数据库里按同样的规则生效，这里决定界面上显示哪些操作）     */
/* ------------------------------------------------------------------ */

/** 组长在组里能做的事（合作组里人人都是组长） */
export interface GroupPermissions {
  /** 改组名和颜色 */
  editGroup: boolean;
  /** 发起删除组、参与删除组和任命组长的投票 */
  deleteGroup: boolean;
  /** 建项目（以及改项目名和颜色、发起删除项目） */
  manageProjects: boolean;
  /** 邀请人进组 */
  invite: boolean;
  /** 看组名单（只在项目里的人看不到） */
  viewRoster: boolean;
}

export function groupPermissions(kind: GroupKind, role: GroupRole | null): GroupPermissions {
  const leader = role === 'leader' && GROUP_KIND_CONFIG[kind].creatable;
  return {
    editGroup: leader,
    deleteGroup: leader,
    manageProjects: leader,
    invite: leader,
    viewRoster: role !== null,
  };
}

/** 组名单里对另一位成员能做的操作 */
export interface GroupMemberActions {
  appointLeader: boolean;
  /** 踢出组（连同他所在的所有项目） */
  remove: boolean;
}

export function groupMemberActions(
  kind: GroupKind,
  actorRole: GroupRole | null,
  target: Pick<GroupMember, 'role' | 'isMe'>,
): GroupMemberActions {
  const config = GROUP_KIND_CONFIG[kind];
  if (!config.creatable || config.everyoneLeader || target.isMe || actorRole !== 'leader') {
    return { appointLeader: false, remove: false };
  }
  return { appointLeader: target.role !== 'leader', remove: target.role !== 'leader' };
}

/** 一个人在某个项目里能做的管理操作 */
export interface ProjectPermissions {
  /** 改项目名和颜色、发起删除项目（组长） */
  editProject: boolean;
  /** 建任务、编辑任务（含 RACI）、删任务（管理员） */
  manageTasks: boolean;
  /** 往项目里加人、把人移出项目（管理员） */
  manageMembers: boolean;
  /** 添加和删除只有名字的人（开了任务分配时，管理员） */
  manageContacts: boolean;
  /** 退出项目（组长不能退出项目） */
  leave: boolean;
}

export function projectPermissions(
  kind: GroupKind,
  project: Pick<Project, 'tools' | 'myRole'>,
): ProjectPermissions {
  if (!GROUP_KIND_CONFIG[kind].creatable) {
    return {
      editProject: false,
      manageTasks: false,
      manageMembers: false,
      manageContacts: false,
      leave: project.myRole !== 'leader',
    };
  }
  const leader = project.myRole === 'leader';
  const admin = leader || project.myRole === 'admin';
  return {
    editProject: leader,
    manageTasks: admin,
    manageMembers: admin,
    manageContacts: admin && featuresForProject(project).contacts,
    leave: !leader,
  };
}

/** 项目名单里对另一位成员能做的操作 */
export interface ProjectMemberActions {
  appointAdmin: boolean;
  revokeAdmin: boolean;
  /** 移出项目 */
  remove: boolean;
}

export function projectMemberActions(
  kind: GroupKind,
  actorRole: ProjectRole,
  target: Pick<ProjectMember, 'role' | 'isMe'>,
): ProjectMemberActions {
  const none = { appointAdmin: false, revokeAdmin: false, remove: false };
  const config = GROUP_KIND_CONFIG[kind];
  // 组长自动在每个项目里，不能被移出
  if (!config.creatable || target.isMe || target.role === 'leader') return none;
  if (actorRole === 'leader') {
    return {
      appointAdmin: config.projectAdmins && target.role === 'member',
      revokeAdmin: config.projectAdmins && target.role === 'admin',
      remove: true,
    };
  }
  if (actorRole === 'admin') return { ...none, remove: target.role === 'member' };
  return none;
}

/** 某个人在某条任务上能做什么 */
export interface TaskPermissions {
  /** 编辑内容（含 RACI）、删除 */
  edit: boolean;
  /** 标记完成 */
  complete: boolean;
  /** 确认完成 / 不通过（A） */
  confirm: boolean;
  /** 取消完成 */
  uncomplete: boolean;
}

/**
 * 个人：什么都能做。
 * 项目：内容由管理员（含组长）编辑；
 *   没开任务分配：项目成员都能标记完成，完成即确认；
 *   开了任务分配：R 标记完成，A 确认或不通过。
 */
export function taskPermissions(
  project: Pick<Project, 'tools' | 'myRole'> | null,
  myRaci: readonly RaciRole[],
): TaskPermissions {
  if (!project) return { edit: true, complete: true, confirm: false, uncomplete: true };
  const admin = project.myRole === 'leader' || project.myRole === 'admin';
  if (!featuresForProject(project).raci) {
    return { edit: admin, complete: true, confirm: false, uncomplete: true };
  }
  const isR = myRaci.includes('R');
  const isA = myRaci.includes('A');
  return { edit: admin, complete: isR, confirm: isA, uncomplete: isR || isA };
}

/** 删除组、删除项目的投票：一周内没有操作的组长算作同意 */
export const GROUP_DELETION_VOTE_DAYS = GROUP_KIND_CONFIG.cooperative.deletionVoteDays;
