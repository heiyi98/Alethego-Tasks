/**
 * 任务详情扩展信息：人物（一对多），对应 task_people 表。
 * 结构对齐未来要对接的外部 API：contactId ↔ 系统通讯录；目前只编辑本地自由文本。
 * （地点已经去掉，以后接地图服务时再作为独立模块加回来。）
 */

export interface TaskPerson {
  id: string;
  taskId: string;
  name: string;
  /** 备注，自由文本（如"客户"、"妈妈"） */
  note: string;
  /** 预留：系统通讯录的联系人 id */
  contactId: string | null;
  createdAt: Date;
}

/** 编辑中的人物；id 为空表示新增 */
export interface TaskPersonDraft {
  id?: string;
  name: string;
  note: string;
}

export type PersonDraftError = 'name_required';

/**
 * 整理人物列表：去除首尾空白，完全空白的行直接忽略；
 * 只填了备注没填姓名的行视为错误（返回出错行的下标）。
 */
export function normalizePeopleDrafts(
  drafts: readonly TaskPersonDraft[],
): { ok: true; people: TaskPersonDraft[] } | { ok: false; error: PersonDraftError; index: number } {
  const people: TaskPersonDraft[] = [];
  for (const [index, draft] of drafts.entries()) {
    const name = draft.name.trim();
    const note = draft.note.trim();
    if (!name && !note) continue;
    if (!name) return { ok: false, error: 'name_required', index };
    people.push({ ...(draft.id ? { id: draft.id } : {}), name, note });
  }
  return { ok: true, people };
}
