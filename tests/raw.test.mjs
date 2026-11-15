/**
 * 0.6.2：没有 Release 的仓库改用「内容/版本」比对。
 * 这里只测底层三件套（rawUrl / rawGet / contentCompare），它们决定
 * 「上游到底变没变」，比 commit 稳、且不耗 API 限流。
 */
export default async function run(ctx) {
  const { loadPlugin, eq, ok, summary } = ctx.harness
  const { mod } = await loadPlugin({})
  const { rawUrl, rawGet, sha256, contentCompare } = mod.__internals

  // ---- rawUrl -------------------------------------------------------------
  eq(
    rawUrl('acme/demo', 'skills/x/SKILL.md'),
    'https://raw.githubusercontent.com/acme/demo/HEAD/skills/x/SKILL.md',
    'rawUrl 拼出 HEAD 地址',
  )
  eq(
    rawUrl('acme/demo', '/skills/x/SKILL.md'),
    'https://raw.githubusercontent.com/acme/demo/HEAD/skills/x/SKILL.md',
    'rawUrl 去掉前导斜杠',
  )
  const encoded = rawUrl('acme/demo', 'a b/中文.md')
  ok(encoded.includes('a%20b'), 'rawUrl 编码空格', encoded)
  ok(!encoded.includes('中文'), 'rawUrl 编码中文路径', encoded)

  // ---- rawGet -------------------------------------------------------------
  const realFetch = globalThis.fetch

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => 'hello',
  })
  const got = await rawGet('https://raw.example/x')
  eq(got.ok, true, 'rawGet 200 → ok')
  eq(got.text, 'hello', 'rawGet 200 → 带 text')

  globalThis.fetch = async () => ({
    ok: false,
    status: 404,
    // 故意不提供 text()：404 时不该去取 body
  })
  const missing = await rawGet('https://raw.example/none')
  eq(missing.ok, false, 'rawGet 404 → ok:false')
  eq(missing.status, 404, 'rawGet 404 → 带 status')

  globalThis.fetch = async () => {
    const error = new Error('aborted')
    error.name = 'AbortError'
    throw error
  }
  const timedOut = await rawGet('https://raw.example/slow')
  eq(timedOut.ok, false, 'rawGet 中止 → ok:false')
  eq(timedOut.error, 'timeout', 'rawGet 中止 → error:timeout')

  globalThis.fetch = async () => {
    throw new TypeError('fetch failed')
  }
  const broken = await rawGet('https://raw.example/broken')
  eq(broken.error, 'network', 'rawGet 网络异常 → error:network')

  // ---- sha256 -------------------------------------------------------------
  eq(sha256('a'), sha256('a'), 'sha256 稳定')
  ok(sha256('a') !== sha256('b'), 'sha256 内容不同则不同')

  // ---- contentCompare -----------------------------------------------------
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/package.json')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ version: '3.1.4' }) }
    }
    return { ok: false, status: 404 }
  }
  const versionMode = await contentCompare({ kind: 'bundle', deepLink: '', location: '' }, 'acme/demo')
  eq(versionMode?.mode, 'version', '插件包走 package.json 版本比对')
  eq(versionMode?.version, '3.1.4', '拿到上游版本号')
  eq(versionMode?.artifact, 'package.json', '记录比对的产物名')

  globalThis.fetch = async () => ({ ok: false, status: 404 })
  const noDeepLink = await contentCompare({ kind: 'skill', deepLink: '', location: '/tmp/x' }, 'acme/demo')
  eq(noDeepLink, null, '技能没有 deepLink 时返回 null（回落 commit 基线）')

  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => 'not-json' })
  const badJson = await contentCompare({ kind: 'bundle', deepLink: '', location: '' }, 'acme/demo')
  eq(badJson, null, '上游 package.json 不是 JSON 时返回 null')

  globalThis.fetch = async () => ({ ok: false, status: 404 })
  const notFound = await contentCompare({ kind: 'bundle', deepLink: '', location: '' }, 'acme/demo')
  eq(notFound, null, 'raw 404 时返回 null（不误判为更新）')

  globalThis.fetch = realFetch
  return summary('raw')
}