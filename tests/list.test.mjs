/** 列表：扫描、来源识别、字段齐全、计数正确。 */
export default async function run({ harness }) {
  const { loadPlugin, call, eq, ok } = harness
  const { routes } = await loadPlugin()

  const res = await call(routes, '/api/github-inventory/list', { method: 'GET' })
  eq(res.status, 200, 'list 返回 200')
  const data = res.json
  ok(Array.isArray(data.items), 'items 是数组')
  eq(data.items.length, 1, '假沙盒里只有 1 个技能')

  const item = data.items[0]
  eq(item.key, 'demo-skill', 'key = demo-skill')
  eq(item.kind, 'skill', 'kind = skill')
  eq(item.enabled, true, '默认启用')
  eq(item.source, 'https://github.com/acme/demo', '来源取自登记表')
  ok(item.provenance === 'registry', '来源等级 = registry', item.provenance)
  eq(item.repoUrl, 'https://github.com/acme/demo', 'repoUrl 指向仓库根')
  eq(item.version, '1.0.0', '版本取自登记表')
  ok(typeof item.files === 'number', '带 files 字段')
  ok('favorite' in item && 'kindLabel' in item, '带 favorite / kindLabel')

  eq(data.counts.total, 1, 'counts.total = 1')
  eq(data.counts.skills, 1, 'counts.skills = 1')
  eq(data.counts.unregistered, 0, 'counts.unregistered = 0')
  ok(data.roots && data.roots.registry, '返回 roots 说明')

  const missing = await call(routes, '/api/nope', { method: 'GET' }).catch((error) => String(error))
  ok(typeof missing === 'string' && missing.includes('没有这条路由'), '未注册路由会抛错')

  return harness.summary('list')
}