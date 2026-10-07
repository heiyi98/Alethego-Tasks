/**
 * RACI 里的人名：一律放在等宽的格子里（宽度刚好放下 4 个汉字，按字号算），放不下时省略号。
 * 简介行、详情、快速添加、责任分配矩阵、甘特图都用它，人名在各处对得齐。
 */
export function PersonName({ name }: { name: string }) {
  return (
    <span className="person-name" title={name}>
      {name}
    </span>
  );
}

/** 同一身份的几个人：并排的格子 */
export function PersonNames({ names }: { names: readonly string[] }) {
  return (
    <span className="person-names">
      {names.map((name, i) => (
        <PersonName key={`${i}:${name}`} name={name} />
      ))}
    </span>
  );
}
