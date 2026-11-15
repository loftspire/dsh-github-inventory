/**
 * 测试入口：建一个假 DSH_HOME 沙盒，跑 tests/*.test.mjs。
 * 用法：node tests/run.mjs（或 npm test）
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const TESTS = ['list.test.mjs', 'check.test.mjs', 'cache.test.mjs', 'raw.test.mjs', 'guards.test.mjs']

function makeFetchMock(calls) {
  return async function fetchMock(url) {
    calls.push(String(url))
    const respond = (status, json, headers = {}) => ({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => headers[name.toLowerCase()] ?? null },
      json: async () => json,
    })
    const target = String(url)
    if (target.includes('/releases/latest')) {
      return respond(200, { tag_name: 'v2.0.0', published_at: '2026-11-01T00:00:00Z' })
    }
    if (target.includes('/commits')) {
      return respond(200, [{ sha: 'abc123', commit: { author: { date: '2026-11-02T00:00:00Z' }, message: 'feat: mock' } }])
    }
    if (target.includes('/contents/package.json')) {
      const body = Buffer.from(JSON.stringify({ name: 'dsh-github-inventory', version: '9.9.9' })).toString('base64')
      return respond(200, { content: body, encoding: 'base64' })
    }
    return respond(404, { message: 'Not Found' })
  }
}

async function buildFixture(home) {
  const dsh = path.join(home, '.dsh')
  await mkdir(path.join(dsh, 'skills', 'demo-skill'), { recursive: true })
  await writeFile(
    path.join(dsh, 'skills', 'demo-skill', 'SKILL.md'),
    '# demo\n\n一个假技能，用于测试。\n',
    'utf8',
  )
  await writeFile(
    path.join(dsh, 'github-inventory.json'),
    JSON.stringify({
      items: [
        {
          key: 'demo-skill',
          kind: 'skill',
          source: 'https://github.com/acme/demo',
          version: '1.0.0',
          installedAt: '2026-11-01T00:00:00Z',
        },
      ],
    }),
    'utf8',
  )
  return dsh
}

async function main() {
  const base = process.env.GI_TEST_BASE || os.tmpdir()
  await mkdir(base, { recursive: true })
  const home = await mkdtemp(path.join(base, 'gi-test-'))
  process.env.DSH_HOME = path.join(home, '.dsh')
  await buildFixture(home)

  const harness = await import('./harness.mjs')
  const calls = []
  const ctx = { home, harness, fetchMock: makeFetchMock(calls), calls }

  let failures = 0
  try {
    for (const file of TESTS) {
      console.log('\n▶ ' + file)
      const mod = await import('./' + file)
      failures += await mod.default(ctx)
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }

  console.log('\n' + (failures === 0 ? '全部通过' : failures + ' 项失败'))
  process.exit(failures === 0 ? 0 : 1)
}

await main()