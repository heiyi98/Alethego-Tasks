/**
 * 任务详情扩展信息：地点（一对一）与人物（一对多），分别对应 task_locations / task_people 表。
 * 结构对齐未来要对接的外部 API：placeId ↔ 地图，contactId ↔ 系统通讯录；目前只编辑本地自由文本。
 */

export interface TaskLocation {
  taskId: string;
  name: string;
  address: string;
  /** 预留：地图 API 的地点 id */
  placeId: string | null;
  lat: number | null;
  lng: number | null;
}

export interface TaskPerson {
  id: string;
  taskId: string;
  name: string;
  /** 与任务 / 本人的关系，自由文本（如"客户"、"妈妈"） */
  relation: string;
  /** 预留：系统通讯录的联系人 id */
  contactId: string | null;
  createdAt: Date;
}

/** 编辑中的地点（本地可编辑字段） */
export interface TaskLocationDraft {
  name: string;
  address: string;
}

/** 编辑中的人物；id 为空表示新增 */
export interface TaskPersonDraft {
  id?: string;
  name: string;
  relation: string;
}

/** 去除首尾空白；名称与地址都为空时返回 null，表示"没有地点"（删除地点） */
export function normalizeLocationDraft(draft: TaskLocationDraft): TaskLocationDraft | null {
  const name = draft.name.trim();
  const address = draft.address.trim();
  return name || address ? { name, address } : null;
}

export type PersonDraftError = 'name_required';

/**
 * 整理人物列表：去除首尾空白，完全空白的行直接忽略；
 * 只填了关系没填姓名的行视为错误（返回出错行的下标）。
 */
export function normalizePeopleDrafts(
  drafts: readonly TaskPersonDraft[],
): { ok: true; people: TaskPersonDraft[] } | { ok: false; error: PersonDraftError; index: number } {
  const people: TaskPersonDraft[] = [];
  for (const [index, draft] of drafts.entries()) {
    const name = draft.name.trim();
    const relation = draft.relation.trim();
    if (!name && !relation) continue;
    if (!name) return { ok: false, error: 'name_required', index };
    people.push({ ...(draft.id ? { id: draft.id } : {}), name, relation });
  }
  return { ok: true, people };
}
