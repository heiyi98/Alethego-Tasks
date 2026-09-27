'use client';

import type { TaskLocation, TaskLocationDraft, TaskPerson } from '@alethego/core';

/**
 * 详情页的扩展字段：地点（一个）与人物（多个）。
 * 目前只编辑本地自由文本；对接地图 / 通讯录时，这里换成对应的选择器即可，数据结构已预留。
 */

export interface PersonRow {
  /** React 列表 key；新增行没有 id */
  key: string;
  id?: string;
  name: string;
  relation: string;
}

export interface ExtensionsFormState {
  location: TaskLocationDraft;
  people: PersonRow[];
}

let rowSeq = 0;
const newKey = () => `new-${++rowSeq}`;

export function extensionsFormFrom(
  location: TaskLocation | null,
  people: readonly TaskPerson[],
): ExtensionsFormState {
  return {
    location: { name: location?.name ?? '', address: location?.address ?? '' },
    people: people.map((p) => ({ key: p.id, id: p.id, name: p.name, relation: p.relation })),
  };
}

export function TaskExtensionsEditor({
  value,
  onChange,
}: {
  value: ExtensionsFormState;
  onChange: (next: ExtensionsFormState) => void;
}) {
  const setLocation = (patch: Partial<TaskLocationDraft>) =>
    onChange({ ...value, location: { ...value.location, ...patch } });

  const setPerson = (key: string, patch: Partial<PersonRow>) =>
    onChange({
      ...value,
      people: value.people.map((p) => (p.key === key ? { ...p, ...patch } : p)),
    });

  return (
    <>
      <fieldset className="field" aria-label="地点">
        <legend className="field-label">地点</legend>
        <div className="field-pair">
          <input
            aria-label="地点名称"
            placeholder="名称，如：公司"
            value={value.location.name}
            onChange={(event) => setLocation({ name: event.target.value })}
          />
          <input
            aria-label="地址"
            placeholder="地址"
            value={value.location.address}
            onChange={(event) => setLocation({ address: event.target.value })}
          />
        </div>
      </fieldset>

      <fieldset className="field" aria-label="人物">
        <legend className="field-label">人物</legend>
        {value.people.length > 0 && (
          <ul className="people-list">
            {value.people.map((person, index) => (
              <li key={person.key} className="field-pair person-row">
                <input
                  aria-label={`第 ${index + 1} 个人物的姓名`}
                  placeholder="姓名"
                  value={person.name}
                  onChange={(event) => setPerson(person.key, { name: event.target.value })}
                />
                <input
                  aria-label={`第 ${index + 1} 个人物的关系`}
                  placeholder="关系，如：客户"
                  value={person.relation}
                  onChange={(event) => setPerson(person.key, { relation: event.target.value })}
                />
                <button
                  type="button"
                  className="button-ghost"
                  aria-label={`删除第 ${index + 1} 个人物`}
                  onClick={() =>
                    onChange({ ...value, people: value.people.filter((p) => p.key !== person.key) })
                  }
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="chip chip-ghost add-person"
          onClick={() =>
            onChange({
              ...value,
              people: [...value.people, { key: newKey(), name: '', relation: '' }],
            })
          }
        >
          + 添加人物
        </button>
      </fieldset>
    </>
  );
}
