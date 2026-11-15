/**
 * 测试脚手架：用假 ctx 把 host 插件装起来，直接调路由 handler。
 *
 * 宿主路由带 cookie 鉴权，外部进程直连只会拿到 401，所以集成测试不走 HTTP，
 * 而是拿到 apply(ctx) 注册的那几个 route 对象，自己造 req/res 调 handler。
 */
import { pathToFileURL } from 'node:url'
import path from 'node:path'

export const ROOT = path.resolve(import.meta.dirname, '..')

/** 载入插件，返回注册到的路由表。fetchImpl 用来替换全局 fetch（离线测试）。 */
export async function loadPlugin({ fetchImpl } = {}) {
  if (fetchImpl) globalThis.fetch = fetchImpl
  const mod = await import(pathToFileURL(path.join(ROOT, 'index.js')).href + '?t=' + Date.now())
  const routes = new Map()
  const ctx = {
    webServer: {
      register(route) {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
    },
    effect(fn) {
      return fn()
    },
    on() {
      return () => {}
    },
  }
  mod.apply(ctx, {})
  return { mod, routes, root: ROOT }
}

export function makeReq({ method = 'GET', body, host = '127.0.0.1:63389', remoteAddress = '127.0.0.1', headers = {} } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
  return {
    method,
    headers: { host, 'sec-fetch-site': 'same-origin', ...headers },
    socket: { remoteAddress },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

export function makeRes() {
  const res = { status: 0, headers: {}, body: '' }
  res.writeHead = (status, extra) => {
    res.status = status
    Object.assign(res.headers, extra || {})
  }
  res.end = (chunk) => {
    if (chunk !== undefined) res.body += String(chunk)
  }
  res.json = () => {
    try {
      return JSON.parse(res.body)
    } catch {
      return null
    }
  }
  return res
}

/** 调一条路由，返回 { status, json }。 */
export async function call(routes, routePath, options) {
  const route = routes.get(routePath)
  if (!route) throw new Error('没有这条路由：' + routePath)
  const res = makeRes()
  await route.handler(makeReq(options), res)
  return { status: res.status, json: res.json(), raw: res.body }
}

let failures = 0
let passes = 0

export function ok(condition, label, detail) {
  if (condition) {
    passes += 1
    console.log('  ✓ ' + label)
  } else {
    failures += 1
    console.log('  ✗ ' + label + (detail === undefined ? '' : ' → ' + JSON.stringify(detail)))
  }
}

export function eq(actual, expected, label) {
  ok(Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected), label, {
    actual,
    expected,
  })
}

export function summary(name) {
  console.log(name + '：' + passes + ' 通过 / ' + failures + ' 失败')
  return failures
}