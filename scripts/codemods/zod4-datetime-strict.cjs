/**
 * zod v4 deprecated 清理 codemod（PR②·第一批）
 *
 * 仅做两类「结构化、行为等价、不触及运行时输出契约」的转换：
 *   1. z.string().datetime()  ->  z.iso.datetime()
 *   2. z.object({...}).strict() -> z.strictObject({...})   （含 .strict().safeParse(...) 链）
 *
 * 故意不碰（留作后续，配合 e2e）：
 *   - z.string().email()/url()：与 .trim()/.max()/.refine() 链式混用，顶层化不等价
 *   - error.flatten()/format()：改的是错误输出结构，触及前端 fieldErrors 契约
 *   - { message } 参数：位置字符串在 v4 仍支持，改了无收益
 *
 * 用法：
 *   npx jscodeshift --parser=tsx --dry --print scripts/codemods/zod4-datetime-strict.cjs <files>   # 预览
 *   npx jscodeshift --parser=tsx scripts/codemods/zod4-datetime-strict.cjs <files>                  # 实际改写
 */
'use strict';

function isZCall(node, methodName) {
  return (
    node &&
    node.type === 'CallExpression' &&
    node.callee &&
    node.callee.type === 'MemberExpression' &&
    node.callee.object &&
    node.callee.object.type === 'Identifier' &&
    node.callee.object.name === 'z' &&
    node.callee.property.name === methodName
  );
}

module.exports = function transformer(file, api) {
  const j = api.jscodeshift;
  const root = j(file.source);
  let changed = 0;

  // 1) z.string().datetime(...) -> z.iso.datetime(...)
  root
    .find(j.CallExpression, { callee: { type: 'MemberExpression', property: { name: 'datetime' } } })
    .forEach((path) => {
      if (isZCall(path.node.callee.object, 'string')) {
        path.node.callee = j.memberExpression(
          j.memberExpression(j.identifier('z'), j.identifier('iso')),
          j.identifier('datetime'),
        );
        changed++;
      }
    });

  // 2) z.object(args).strict() -> z.strictObject(args)
  root
    .find(j.CallExpression, {
      callee: { type: 'MemberExpression', property: { name: 'strict' }, computed: false },
      arguments: [],
    })
    .forEach((path) => {
      const obj = path.node.callee.object; // z.object(args)
      if (isZCall(obj, 'object')) {
        obj.callee.property = j.identifier('strictObject');
        j(path).replaceWith(obj);
        changed++;
      }
    });

  return changed ? root.toSource({ quote: 'single' }) : null;
};
