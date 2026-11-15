/** 守卫：只允回环 + 同源，写操作只允许 POST，非法 key 一律拒绝。 */
export default async function run({ harness }) {
  const { loadPlugin, call, eq, ok } = harness
  const { routes } = await loadPlugin()
  const POSTS = ['/api/github-inventory/skill', '/api/github-inventory/favorite', '/api/github-inventory/source']

  for (const route of POSTS) {
    const get = await call(routes, route, { method: 'GET' })
    eq(get.status, 405, route + ' 用 GET → 405')
  }

  const far = await call(routes, '/api/github-inventory/list', {
    method: 'GET',
    host: '10.0.0.5:63389',
    remoteAddress: '10.0.0.5',
  })
  eq(far.status, 403, '非回环来源 → 403')

  const crossSite = await call(routes, '/api/github-inventory/skill', {
    method: 'POST',
    body: { key: 'demo-skill', enabled: false },
    headers: { 'sec-fetch-site': 'cross-site' },
  })
  eq(crossSite.status, 403, 'sec-fetch-site: cross-site → 403')

  const traversal = await call(routes, '/api/github-inventory/skill', {
    method: 'POST',
    body: { id: '../evil', enabled: false },
  })
  eq(traversal.status, 400, '路径穿越 key → 400')

  const badSource = await call(routes, '/api/github-inventory/source', {
    method: 'POST',
    body: { key: 'demo-skill', source: 'javascript:alert(1)' },
  })
  eq(badSource.status, 400, '非 http(s) 来源 → 400')

  const goodSource = await call(routes, '/api/github-inventory/source', {
    method: 'POST',
    body: { key: 'demo-skill', source: 'https://github.com/acme/another' },
  })
  eq(goodSource.status, 200, '合法来源被接受')
  ok(goodSource.json.ok === true, '返回 ok')

  const list = await call(routes, '/api/github-inventory/list', { method: 'GET' })
  eq(list.json.items[0].source, 'https://github.com/acme/another', '来源写回后列表立刻反映')

  const toggle = await call(routes, '/api/github-inventory/skill', {
    method: 'POST',
    body: { key: 'demo-skill', enabled: false },
  })
  eq(toggle.status, 200, '停用技能 → 200')
  const afterOff = await call(routes, '/api/github-inventory/list', { method: 'GET' })
  eq(afterOff.json.items[0].enabled, false, '停用后 enabled = false')

  const back = await call(routes, '/api/github-inventory/skill', {
    method: 'POST',
    body: { key: 'demo-skill', enabled: true },
  })
  eq(back.status, 200, '重新启用 → 200')

  return harness.summary('guards')
}