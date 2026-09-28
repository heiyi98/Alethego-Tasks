-- 分类描述：可选的自由文本，默认空字符串。
-- 只新增一列（有默认值），不改动已有字段与约束；已有分类的描述为空。
alter table taskapp.categories
  add column description text not null default '';

comment on column taskapp.categories.description is '分类描述，自由文本，可为空字符串';
