/** 检查更新：有 release 比版本、自身版本比对、限流要能被看见。 */
export default async function run(ctx) {
  const { loadPlugin, call, eq, ok } = ctx.harness

  const { routes } = await loadPlugin({ fetchImpl: ctx.fetchMock })
  const res = await call(routes, '/api/github-inventory/check', { method: 'POST' })
  eq(res.status, 200, 'check 返回 200')
  const data = res.json
  eq(data.ok, true, 'ok = true')
  ok(data.repos >= 1, '按仓库归并（至少 1 个仓库）', data.repos)

  const update = data.items['demo-skill']
  eq(update.state, 'newer', 'release v2.0.0 高于本地 1.0.0 → newer')
  eq(update.latestVersion, '2.0.0', 'latestVersion 去掉 v 前缀')
  eq(data.errors, 0, '没有失败项')
  eq(data.rateLimit, null, '没有限流时不带 rateLimit')

  ok(data.self && data.self.local, 'self.local 有值')
  eq(data.self.remote, '9.9.9', '读到了远端 package.json 版本')
  eq(data.self.newer, true, '远端更高 → self.newer = true')

  const list = await call(routes, '/api/github-inventory/list', { method: 'GET' })
  const listed = list.json.items[0]
  eq(listed.update.state, 'newer', '列表带上了检查结果')
  eq(list.json.counts.updatable, 1, 'counts.updatable = 1')
  eq(list.json.counts.failed, 0, 'counts.failed = 0')
  ok(list.json.checksAt, '带 checksAt 时间戳')

  // 限流：403 + x-ratelimit-remaining: 0 → 必须能和「没有更新」区分开
  const limitedFetch = async () => ({
    ok: false,
    status: 403,
    headers: { get: (name) => (name.toLowerCase() === 'x-ratelimit-remaining' ? '0' : name.toLowerCase() === 'x-ratelimit-reset' ? '1794000000' : null) },
    json: async () => ({ message: 'API rate limit exceeded' }),
  })
  const limited = await loadPlugin({ fetchImpl: limitedFetch })
  const limitedRes = await call(limited.routes, '/api/github-inventory/check', { method: 'POST', body: { force: true } })
  eq(limitedRes.status, 200, '限流时 check 仍返回 200')
  ok(limitedRes.json.rateLimit && limitedRes.json.rateLimit.remaining === 0, 'rateLimit.remaining = 0')
  ok(limitedRes.json.rateLimit?.resetAt, 'rateLimit.resetAt 有值')
  eq(limitedRes.json.errors, 1, '限流导致 1 项查不到')
  ok(/限流/.test(limitedRes.json.errorSample), '失败原因写明是限流', limitedRes.json.errorSample)
  ok(/限流/.test(limitedRes.json.items['demo-skill'].error), '条目错误里也写明限流')

  const limitedList = await call(limited.routes, '/api/github-inventory/list', { method: 'GET' })
  ok(limitedList.json.rateLimit && limitedList.json.rateLimit.remaining === 0, '列表带出 rateLimit')
  eq(limitedList.json.counts.failed, 1, '列表 counts.failed = 1')

  return ctx.harness.summary('check')
}