/**
 * 检查结果缓存：30 分钟内复用，force 穿透，条目变了旧结果不许冒充当前状态。
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export default async function run(ctx) {
  const { loadPlugin, call, eq, ok } = ctx.harness
  const { routes } = await loadPlugin({ fetchImpl: ctx.fetchMock })

  // 先把基线做成「一次正常检查」——前面的限流用例可能刚写过一条错误结果
  const base = await call(routes, '/api/github-inventory/check', { method: 'POST', body: { force: true } })
  eq(base.status, 200, 'force 检查返回 200')
  eq(base.json.cached, false, 'force:true 不读缓存')
  eq(base.json.items['demo-skill'].state, 'newer', '基线：demo-skill 有新版本')
  ok(Number(base.json.expiresAt) > Date.now(), '带未来的 expiresAt')

  // 同一个指纹、缓存还新鲜 → 必须复用，而不是再打一遍 GitHub
  const again = await call(routes, '/api/github-inventory/check', { method: 'POST' })
  eq(again.status, 200, 'check 无 body 也返回 200')
  eq(again.json.cached, true, '30 分钟内重复请求复用缓存')
  eq(again.json.checkedAt, base.json.checkedAt, '复用的是同一次检查结果')
  eq(again.json.items['demo-skill'].state, 'newer', '缓存里带着上次的结论')
  ok(Number(again.json.expiresAt) > Date.now(), '缓存也带 expiresAt')

  // force 必须穿透
  const forced = await call(routes, '/api/github-inventory/check', { method: 'POST', body: { force: true } })
  eq(forced.status, 200, 'force 请求返回 200')
  eq(forced.json.cached, false, 'force:true 穿透缓存')
  eq(forced.json.items['demo-skill'].state, 'newer', '穿透后仍拿到新版本')

  // 条目变了（本地版本改了）→ 旧结果不许再挂到列表上
  const registryPath = path.join(process.env.DSH_HOME, 'github-inventory.json')
  const registry = JSON.parse(await readFile(registryPath, 'utf8'))
  registry.items[0].version = '1.5.0'
  await writeFile(registryPath, JSON.stringify(registry), 'utf8')

  const staleList = await call(routes, '/api/github-inventory/list', { method: 'GET' })
  eq(staleList.status, 200, 'list 返回 200')
  eq(staleList.json.items[0].update, null, '指纹不符时列表不挂旧结论')
  eq(staleList.json.counts.updatable, 0, '指纹不符时 counts.updatable = 0')

  // 条目变了，再查一次必须真的重查（不能命中缓存）
  const recheck = await call(routes, '/api/github-inventory/check', { method: 'POST' })
  eq(recheck.json.cached, false, '指纹变了 → 缓存失效')
  eq(recheck.json.items['demo-skill'].state, 'newer', '重查后仍判定有新版本')

  const freshList = await call(routes, '/api/github-inventory/list', { method: 'GET' })
  eq(freshList.json.items[0].update?.state, 'newer', '重查后列表恢复显示')
  eq(freshList.json.counts.updatable, 1, 'counts.updatable 回到 1')

  return ctx.harness.summary('cache')
}