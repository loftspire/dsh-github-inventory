/**
 * dsh-github-inventory — host half.
 *
 * 扫描本机由 GitHub 装进来的东西（技能 / 命令行工具 / 插件包），
 * 供设置页「GitHub 下载」一页展示与开关。技能可开关（目录在 ~/.dsh/skills
 * 与 ~/.dsh/skills-disabled 之间搬动），其余只读展示。
 */
import { readFile, writeFile, mkdir, readdir, stat, rename, cp, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const name = 'github-inventory'
export const inject = ['webServer']

const HOME = os.homedir()
const DSH_HOME = process.env.DSH_HOME || path.join(HOME, '.dsh')
const SKILL_ROOTS = [
  { id: 'user-dsh', label: '~/.dsh/skills', dir: path.join(DSH_HOME, 'skills') },
  { id: 'user-agents', label: '~/.agents/skills', dir: path.join(HOME, '.agents', 'skills') },
]
const STASH_DIR = path.join(DSH_HOME, 'skills-disabled')
const REGISTRY_FILE = path.join(DSH_HOME, 'github-inventory.json')
const STATE_FILE = path.join(DSH_HOME, 'github-inventory-state.json')
const FAVORITE_FILE = path.join(DSH_HOME, 'github-inventory-favorites.json')
const CATALOG_FILE = new URL('./catalog.json', import.meta.url)

const API_LIST = '/api/github-inventory/list'
const API_SKILL = '/api/github-inventory/skill'
const API_FAVORITE = '/api/github-inventory/favorite'
const API_SOURCE = '/api/github-inventory/source'

const KIND_LABELS = { skill: '技能', cli: '命令行工具', bundle: '插件包' }

/** 来源可信度分级：越靠前越硬。 */
const PROVENANCE_LABELS = {
  registry: '已登记',
  marker: '目录自证',
  header: '目录自证',
  git: '仓库副本',
  catalog: '随包目录',
  inferred: '推断',
  unknown: '未知',
}

/* ---------------------------------------------------------------- utilities */

async function exists(p) {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function readText(p) {
  try {
    return await readFile(p, 'utf8')
  } catch {
    return null
  }
}

async function readJsonFile(p, fallback) {
  const text = await readText(p)
  if (!text) return fallback
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

async function writeJsonFile(p, value) {
  await mkdir(path.dirname(p), { recursive: true })
  await writeFile(p, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

/** 极简 frontmatter 解析：只取单行标量，够读 SKILL.md 的 name/description。 */
function parseFrontmatter(text) {
  if (!text) return {}
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return {}
  const out = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!kv) continue
    let v = kv[2].trim()
    if (v === '>' || v === '|' || v === '>-' || v === '|-' || v === '>+' || v === '|+') v = ''
    if (v.length > 1 && ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'"))) {
      v = v.slice(1, -1)
    }
    out[kv[1]] = v
  }
  return out
}

function firstParagraph(text) {
  if (!text) return ''
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  for (const raw of body.split(/\r?\n\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    return line.replace(/\s+/g, ' ')
  }
  return ''
}

function clamp(text, max = 260) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

/* ------------------------------------------------------------- provenance */

async function readCatalog() {
  const text = await readText(CATALOG_FILE)
  if (!text) return { items: {} }
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && parsed.items ? parsed : { items: {} }
  } catch {
    return { items: {} }
  }
}

function githubUrlFrom(text) {
  const m = /https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/.exec(String(text || ''))
  return m ? m[0].replace(/[.,;:)\]]+$/, '') : ''
}

function repoFromRemote(remote) {
  const s = String(remote || '').trim()
  let m = /^https?:\/\/[^/\s]*github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(s)
  if (!m) m = /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(s)
  return m ? 'https://github.com/' + m[1] + '/' + m[2] : ''
}

/**
 * 来源解析，硬到软依次是：本机登记表 > 目录内 .dsh-source.json > SKILL.md 的
 * source/repository/homepage > .git/config 的 remote > 随包 catalog.json > README 里的首个
 * GitHub 链接（标「推断」）。都不命中就是「未知」。
 */
async function resolveProvenance(key, dir, entry, meta, catalog) {
  if (entry?.source) {
    return { level: 'registry', source: entry.source, downloadUrl: entry.downloadUrl || '', deepLink: '' }
  }

  const marker = await readJsonFile(path.join(dir, '.dsh-source.json'), null)
  if (marker && typeof marker.source === 'string' && marker.source.trim()) {
    return {
      level: 'marker',
      source: marker.source.trim(),
      downloadUrl: typeof marker.downloadUrl === 'string' ? marker.downloadUrl : '',
      deepLink: '',
    }
  }

  const headerSource = githubUrlFrom(meta?.source || meta?.repository || meta?.repo || meta?.homepage || '')
  if (headerSource) return { level: 'header', source: headerSource, downloadUrl: '', deepLink: '' }

  const gitConfig = await readText(path.join(dir, '.git', 'config'))
  const remote = gitConfig ? (/(?:^|\n)\s*url\s*=\s*(\S+)/.exec(gitConfig)?.[1] || '') : ''
  const repo = repoFromRemote(remote)
  if (repo) return { level: 'git', source: repo, downloadUrl: '', deepLink: '' }

  const cat = catalog?.items?.[key]
  if (cat?.source) {
    const base = String(cat.source).replace(/\/+$/, '')
    return {
      level: 'catalog',
      source: base,
      downloadUrl: cat.downloadUrl || '',
      deepLink: cat.path ? base + '/tree/main/' + String(cat.path).replace(/^\/+/, '') : '',
    }
  }

  for (const name of ['README.md', 'README_EN.md']) {
    const url = githubUrlFrom(await readText(path.join(dir, name)))
    if (url) return { level: 'inferred', source: url, downloadUrl: '', deepLink: '' }
  }

  return { level: 'unknown', source: '', downloadUrl: '', deepLink: '' }
}

/** 从仓库地址与版本推出「原页面」「下载页」两个外链。 */
function withLinks(item) {
  const raw = String(item.source || '').replace(/\/+$/, '')
  if (!raw) return { ...item, repoUrl: '', downloadUrl: '', deepLink: '' }
  if (item.deepLink) return { ...item, repoUrl: raw, downloadUrl: item.deepLink }
  const version = String(item.version || '').trim()
  const semver = /^v?\d+\.\d+/.test(version)
  const tag = semver ? (version.startsWith('v') ? version : 'v' + version) : ''
  const downloadUrl = item.downloadUrl || (tag ? raw + '/releases/tag/' + tag : raw + '/releases')
  return { ...item, repoUrl: raw, downloadUrl }
}

/* ------------------------------------------------------------------ collections */

/** 同一个上游仓库里装的一批东西，在列表里收成一个二级目录。 */
const COLLECTION_TITLES = {
  'yuan1z0825/nature-skills': 'Nature 学术套件',
  office: 'Office 文档',
  'loftspire/dsh-github-inventory': 'GitHub 下载面板',
}

/** 找出这一项属于哪个合集（同一仓库 ≥2 项，或同一前缀 ≥2 项）；不属于任何合集返回 null。 */
function collectionOf(item, pool) {
  const own = repoFromSource(item.source || '') || repoFromSource(item.repoUrl || '') || ''
  if (own) {
    const same = pool.filter(
      (x) => (repoFromSource(x.source || '') || repoFromSource(x.repoUrl || '') || '') === own,
    )
    if (same.length >= 2) {
      const id = 'repo:' + own.toLowerCase()
      const title = COLLECTION_TITLES[own.toLowerCase()] || own.split('/')[1] || own
      return { id, title, size: same.length }
    }
  }
  const key = String(item.key || '')
  const prefix = key.split('-')[0]
  if (prefix && prefix.length >= 4) {
    const same = pool.filter(
      (x) => x.kind === item.kind && (x.key === prefix || String(x.key || '').startsWith(prefix + '-')),
    )
    if (same.length >= 2) {
      const id = 'prefix:' + prefix.toLowerCase()
      return { id, title: COLLECTION_TITLES[prefix.toLowerCase()] || prefix, size: same.length }
    }
  }
  return null
}

/* ------------------------------------------------------------------ scanning */

async function scanSkills() {
  const stashed = await readJsonFile(STATE_FILE, {})
  const registry = await readJsonFile(REGISTRY_FILE, { items: [] })
  const catalog = await readCatalog()
  const byKey = new Map()
  for (const entry of registry.items || []) {
    if (entry && entry.key) byKey.set(entry.key, entry)
  }

  const items = []
  for (const root of SKILL_ROOTS) {
    let names = []
    try {
      names = await readdir(root.dir)
    } catch {
      continue
    }
    for (const key of names.sort()) {
      if (key.startsWith('.')) continue
      const dir = path.join(root.dir, key)
      const info = await stat(dir).catch(() => null)
      if (!info || !info.isDirectory()) continue
      const md = await readText(path.join(dir, 'SKILL.md'))
      if (md == null) continue
      items.push(await buildSkillItem(key, dir, root.id, root.label, true, md, byKey.get(key), stashed, undefined, catalog))
    }
  }

  let stashedNames = []
  try {
    stashedNames = await readdir(STASH_DIR)
  } catch {
    stashedNames = []
  }
  for (const key of stashedNames.sort()) {
    if (key.startsWith('.')) continue
    const dir = path.join(STASH_DIR, key)
    const info = await stat(dir).catch(() => null)
    if (!info || !info.isDirectory()) continue
    const md = await readText(path.join(dir, 'SKILL.md'))
    if (md == null) continue
    const originRoot = SKILL_ROOTS.find((r) => r.dir === stashed[key])
    items.push(
      await buildSkillItem(
        key,
        dir,
        'stash',
        '~/.dsh/skills-disabled',
        false,
        md,
        byKey.get(key),
        stashed,
        originRoot && originRoot.label,
        catalog,
      ),
    )
  }
  return items
}

async function buildSkillItem(key, dir, rootId, rootLabel, enabled, md, entry, stashed, originLabel, catalog) {
  const meta = parseFrontmatter(md)
  const stats = await stat(dir).catch(() => null)
  const children = await readdir(dir).catch(() => [])
  const prov = await resolveProvenance(key, dir, entry, meta, catalog)
  const cat = catalog?.items?.[key]
  return {
    id: 'skill:' + key,
    kind: 'skill',
    key,
    title: entry?.title || meta.name || key,
    summary: clamp(entry?.summary || meta.description || cat?.summary || firstParagraph(md)),
    summaryFull: String(entry?.summary || meta.description || cat?.summary || firstParagraph(md) || '').trim(),
    source: prov.source,
    downloadUrl: prov.downloadUrl,
    deepLink: prov.deepLink,
    provenance: prov.level,
    provenanceLabel: PROVENANCE_LABELS[prov.level] || prov.level,
    version: entry?.version || '',
    installedAt: entry?.installedAt || (stats ? stats.mtime.toISOString().slice(0, 10) : ''),
    location: dir,
    root: rootLabel,
    origin: enabled ? rootLabel : originLabel || rootLabel,
    enabled: Boolean(enabled),
    toggleable: true,
    registered: Boolean(prov.source),
    hasRegistryEntry: Boolean(entry),
    files: children.filter((n) => !n.startsWith('.')).length,
  }
}

async function scanRegistryItems(items, registry) {
  const seen = new Set(items.map((i) => i.key))
  for (const entry of registry.items || []) {
    if (!entry || !entry.key || entry.kind !== 'cli') continue
    if (seen.has(entry.key)) continue
    const present = entry.cli ? await exists(entry.cli) : false
    items.push({
      id: 'cli:' + entry.key,
      kind: 'cli',
      key: entry.key,
      title: entry.title || entry.key,
      summary: clamp(entry.summary),
      summaryFull: String(entry.summary || '').trim(),
      source: entry.source || '',
      downloadUrl: entry.downloadUrl || '',
      version: entry.version || '',
      installedAt: entry.installedAt || '',
      location: entry.cli || '',
      root: present ? '直接可执行' : '未找到可执行文件',
      enabled: present,
      toggleable: false,
      deepLink: '',
      provenance: entry.source ? 'registry' : 'unknown',
      provenanceLabel: PROVENANCE_LABELS[entry.source ? 'registry' : 'unknown'],
      registered: Boolean(entry.source),
      hasRegistryEntry: true,
    })
  }
}

async function scanBundles(registry) {
  const profileDir = process.env.DSH_PROFILE_DIR
  if (!profileDir) return []
  const pkg = await readJsonFile(path.join(profileDir, 'package.json'), null)
  const bundles = pkg?.dsh?.profile?.bundles
  if (!Array.isArray(bundles)) return []
  const entries = new Map()
  for (const entry of registry.items || []) {
    if (entry && entry.kind === 'bundle' && entry.key) entries.set(entry.key, entry)
  }
  const out = []
  for (const pkgName of bundles) {
    const entry = entries.get(pkgName)
    if (!entry) continue // 只展示 GitHub 来源、且已登记的插件包
    let version = ''
    const manifest = await readJsonFile(path.join(profileDir, 'node_modules', pkgName, 'package.json'), null)
    if (manifest?.version) version = manifest.version
    out.push({
      id: 'bundle:' + pkgName,
      kind: 'bundle',
      key: pkgName,
      title: entry.title || pkgName,
      summary: clamp(entry.summary),
      summaryFull: String(entry.summary || '').trim(),
      source: entry.source || '',
      downloadUrl: entry.downloadUrl || '',
      version: entry.version || version,
      installedAt: entry.installedAt || '',
      location: path.join(profileDir, 'node_modules', pkgName),
      root: '插件页管理',
      enabled: true,
      toggleable: false,
      deepLink: '',
      provenance: entry.source ? 'registry' : 'unknown',
      provenanceLabel: PROVENANCE_LABELS[entry.source ? 'registry' : 'unknown'],
      registered: Boolean(entry.source),
      hasRegistryEntry: true,
    })
  }
  return out
}

async function buildList() {
  const registry = await readJsonFile(REGISTRY_FILE, { items: [] })
  const favorites = await readFavorites()
  const skills = await scanSkills()
  const items = [...skills]
  await scanRegistryItems(items, registry)
  items.push(...(await scanBundles(registry)))

  const order = { skill: 0, cli: 1, bundle: 2 }
  items.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || a.title.localeCompare(b.title))
  const stored = await readJsonFile(CHECK_FILE, null)
  const checks = stored && stored.fingerprint === checkFingerprint(items) ? stored : null
  const updateOf = (key) => (checks?.items && checks.items[key] ? checks.items[key] : null)
  const base = items.map((item) =>
    withLinks({
      ...item,
      favorite: favorites.has(item.key),
      kindLabel: KIND_LABELS[item.kind] || item.kind,
      update: updateOf(item.key),
    }),
  )
  const linked = base.map((item) => ({ ...item, collection: collectionOf(item, base) }))

  return {
    items: linked,
    counts: {
      total: items.length,
      enabled: items.filter((i) => i.enabled).length,
      disabled: items.filter((i) => !i.enabled).length,
      skills: items.filter((i) => i.kind === 'skill').length,
      cli: items.filter((i) => i.kind === 'cli').length,
      bundle: items.filter((i) => i.kind === 'bundle').length,
      unregistered: items.filter((i) => !i.registered).length,
      unknown: items.filter((i) => !i.registered).length,
      inferred: items.filter((i) => i.provenance === 'inferred').length,
      favorite: items.filter((i) => favorites.has(i.key)).length,
      updatable: linked.filter((i) => i.update?.state === 'newer').length,
      checked: linked.filter((i) => i.update).length,
      failed: linked.filter((i) => i.update?.state === 'error').length,
    },
    self: checks?.self || null,
    checksAt: checks?.checkedAt || '',
    rateLimit: checks?.rateLimit || null,
    checkErrorSample: checks?.errorSample || '',
    roots: {
      skills: SKILL_ROOTS.map((r) => r.label),
      stash: '~/.dsh/skills-disabled',
      registry: REGISTRY_FILE,
      catalog: 'dsh-github-inventory/catalog.json',
    },
    scannedAt: new Date().toISOString(),
  }
}

async function readFavorites() {
  const raw = await readJsonFile(FAVORITE_FILE, { keys: [] })
  const keys = Array.isArray(raw?.keys) ? raw.keys.filter((k) => typeof k === 'string' && k) : []
  return new Set(keys)
}

async function setFavorite(key, favorite) {
  const favorites = await readFavorites()
  if (favorite) favorites.add(key)
  else favorites.delete(key)
  await writeJsonFile(FAVORITE_FILE, { keys: [...favorites].sort() })
  return { key, favorite: Boolean(favorite) }
}

/* ------------------------------------------------------------------- toggling */

async function moveDir(from, to) {
  await mkdir(path.dirname(to), { recursive: true })
  try {
    await rename(from, to)
  } catch (error) {
    if (error && (error.code === 'EXDEV' || error.code === 'EPERM')) {
      await cp(from, to, { recursive: true })
      await rm(from, { recursive: true, force: true })
      return
    }
    throw error
  }
}

async function setSkillEnabled(key, enabled) {
  if (!key || /[\\/]/.test(key) || key.startsWith('.')) throw new Error('invalid skill id')
  const state = await readJsonFile(STATE_FILE, {})
  const live = SKILL_ROOTS.map((r) => path.join(r.dir, key)).find((p) => p)
  const stashedPath = path.join(STASH_DIR, key)

  if (enabled) {
    if (!(await exists(stashedPath))) throw new Error('skill is not disabled')
    const originDir = state[key] || SKILL_ROOTS[0].dir
    const target = path.join(originDir, key)
    if (await exists(target)) throw new Error('a skill with this name already exists in ' + originDir)
    await moveDir(stashedPath, target)
    delete state[key]
    await writeJsonFile(STATE_FILE, state)
    return { key, enabled: true, location: target }
  }

  const source = await Promise.all(live ? [live] : SKILL_ROOTS.map((r) => path.join(r.dir, key)))
  const found = []
  for (const candidate of source) if (await exists(candidate)) found.push(candidate)
  if (found.length === 0) throw new Error('skill not found')
  const from = found[0]
  if (await exists(stashedPath)) throw new Error('a disabled copy of this skill already exists')
  await moveDir(from, stashedPath)
  state[key] = path.dirname(from)
  await writeJsonFile(STATE_FILE, state)
  return { key, enabled: false, location: stashedPath }
}

/* -------------------------------------------------------------- update checks */

const CHECK_FILE = path.join(DSH_HOME, 'github-inventory-checks.json')
/** 检查结果的有效期：这段时间内重复请求直接复用，点「检查更新」才强制穿透。 */
const CHECK_TTL_MS = 30 * 60 * 1000
/** 这一轮有失败项（限流/网络）时只缓存 1 分钟：错的结论不值得压半小时。 */
const CHECK_ERROR_TTL_MS = 60 * 1000
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url))
const SELF_REPO = 'loftspire/dsh-github-inventory'
const SELF_BRANCH = 'main'
const SKIP_DIRS = new Set(['.git', 'node_modules'])

const API_CHECK = '/api/github-inventory/check'
const API_SELF_UPDATE = '/api/github-inventory/self-update'
const API_RESTART = '/api/github-inventory/restart'

function repoFromSource(source) {
  const m = /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/.exec(String(source || ''))
  if (!m) return ''
  return m[1] + '/' + m[2].replace(/\.git$/i, '')
}

function pathFromDeepLink(deepLink) {
  const m = /\/tree\/[^/]+\/(.+)$/.exec(String(deepLink || ''))
  return m ? m[1].replace(/\/+$/, '') : ''
}

function readToken() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
}

function semverOf(text) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(text || ''))
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

function compareSemver(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

/**
 * 只读的 GitHub REST 调用；404 视为正常空结果，不抛。
 * 额外带回 rateLimit 与 reason：限流/超时/网络必须能和「没有更新」区分开。
 */
async function githubApi(apiPath) {
  const token = readToken()
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'dsh-github-inventory' }
  if (token) headers.authorization = 'Bearer ' + token
  try {
    const response = await fetch('https://api.github.com' + apiPath, {
      headers,
      signal: AbortSignal.timeout(15000),
    })
    const remainingRaw = response.headers.get('x-ratelimit-remaining')
    const resetRaw = response.headers.get('x-ratelimit-reset')
    const limitRaw = response.headers.get('x-ratelimit-limit')
    const rateLimit =
      remainingRaw === null || remainingRaw === ''
        ? null
        : {
            remaining: Number(remainingRaw),
            limit: Number(limitRaw) || 0,
            resetAt: Number.isFinite(Number(resetRaw)) && resetRaw !== null ? new Date(Number(resetRaw) * 1000).toISOString() : '',
          }
    if (response.status === 404) return { ok: false, status: 404, json: null, rateLimit, reason: 'not-found' }
    const json = await response.json().catch(() => null)
    const exhausted =
      (response.status === 403 || response.status === 429) && rateLimit !== null && rateLimit.remaining === 0
    const reason = response.ok ? '' : exhausted ? 'rate-limit' : 'http-' + response.status
    return { ok: response.ok, status: response.status, json, rateLimit, reason }
  } catch (error) {
    const message = String(error?.message || error)
    return {
      ok: false,
      status: 0,
      json: null,
      reason: /timeout|timed out|aborted/i.test(message) ? 'timeout' : 'network',
      error: message,
    }
  }
}

/** 把一次失败的 API 调用翻译成能直接给用户看的一句话。 */
function describeApiError(res) {
  if (!res) return '未知错误'
  if (res.reason === 'rate-limit') {
    const when = res.rateLimit?.resetAt ? '，' + res.rateLimit.resetAt.slice(11, 16) + ' UTC 后恢复' : ''
    return 'GitHub 限流（未登录 60 次/小时）' + when
  }
  if (res.reason === 'timeout') return '网络超时（15 秒）'
  if (res.reason === 'network') return '网络不通：' + (res.error || '连接失败')
  if (res.reason === 'not-found') return '仓库或路径不存在（404）'
  return 'HTTP ' + res.status
}

/** 没有 Release 的仓库：直接比对上游文件内容（技能比 SKILL.md，插件包比 package.json 版本）。
 *  比 commit 稳：只要仓库里别的文件动了（改 README、发别的 release），commit 就变，会永远「有新版本」。 */
const RAW_BASE = 'https://raw.githubusercontent.com'

function rawUrl(repo, relPath) {
  const clean = String(relPath || '')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')
  return RAW_BASE + '/' + repo + '/HEAD/' + clean
}

async function rawGet(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'dsh-github-inventory' } })
    if (!res.ok) return { ok: false, status: res.status }
    const text = typeof res.text === 'function' ? await res.text() : ''
    return { ok: true, status: res.status, text }
  } catch (error) {
    return { ok: false, status: 0, error: error?.name === 'AbortError' ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
  }
}

function sha256(text) {
  return createHash('sha256').update(String(text)).digest('hex')
}

/** 拿上游对得上的那个文件的指纹：技能用 SKILL.md 的内容哈希，其它用 package.json 的版本号。 */
async function contentCompare(item, repo) {
  if (!repo) return null
  if (item.kind === 'skill') {
    const rel = pathFromDeepLink(item.deepLink)
    // 候选路径：登记了子目录就先看它；否则按「仓库根 SKILL.md」→「skills/<key>/SKILL.md」依次试，
    // 这样仓库根上放的技能和 Nature 那种 skills/<name>/ 结构都能比到。
    const candidates = rel ? [rel + '/SKILL.md'] : ['SKILL.md', 'skills/' + item.key + '/SKILL.md']
    for (const candidate of candidates) {
      const remote = await rawGet(rawUrl(repo, candidate))
      if (remote.ok && remote.text) {
        return { mode: 'content', sha: sha256(remote.text), artifact: candidate }
      }
    }
    return null
  }
  const remote = await rawGet(rawUrl(repo, 'package.json'))
  if (!remote.ok) return null
  let remoteVersion = ''
  try {
    remoteVersion = JSON.parse(remote.text).version || ''
  } catch {
    return null
  }
  if (!remoteVersion) return null
  return { mode: 'version', version: remoteVersion, artifact: 'package.json' }
}

async function checkRepo(repo, pathHint) {
  const out = {
    repo,
    checkedAt: new Date().toISOString(),
    sha: '',
    date: '',
    message: '',
    release: '',
    releaseAt: '',
    error: '',
  }
  const query = pathHint ? '?path=' + encodeURIComponent(pathHint) + '&per_page=1' : '?per_page=1'
  const commits = await githubApi('/repos/' + repo + '/commits' + query)
  if (commits.ok && Array.isArray(commits.json) && commits.json[0]) {
    const first = commits.json[0]
    out.sha = first.sha || ''
    out.date = first.commit?.author?.date || ''
    out.message = String(first.commit?.message || '').split('\n')[0].slice(0, 140)
  } else if (!commits.ok && commits.status !== 404) {
    out.error = commits.reason === 'not-found' ? '' : describeApiError(commits)
    out.reason = commits.reason || ''
  }
  const release = await githubApi('/repos/' + repo + '/releases/latest')
  if (release.ok && release.json) {
    out.release = release.json.tag_name || ''
    out.releaseAt = release.json.published_at || ''
  }
  out.rateLimit = (commits.rateLimit && commits.rateLimit.remaining === 0 ? commits.rateLimit : null) ||
    (release.rateLimit && release.rateLimit.remaining === 0 ? release.rateLimit : null) ||
    null
  return out
}

/** 逐项比对上游：有 release 的比版本号，没有的比目标路径最新 commit 与本地基线。 */
/** 一份检查结果只对「这一批条目」有效：条目集合、版本、来源任何一项变了都要重查。 */
function checkFingerprint(items) {
  const parts = items
    .map((item) => [item.key, item.version || '', item.source || '', item.deepLink || ''].join('\u0001'))
    .sort()
  return createHash('sha256').update(parts.join('\u0002')).digest('hex').slice(0, 16)
}

/** 用内容/版本比对的结果下结论；返回 { next, stamp }，stamp 非空时要写回基线。 */
function decideByContent(item, repo, content, prev, sha) {
  const stamp = {
    repo,
    sha: sha || '',
    content: content.sha || '',
    version: content.version || '',
    artifact: content.artifact,
    at: new Date().toISOString(),
  }
  if (!prev || prev.repo !== repo) {
    return { stamp, next: { state: 'baseline', repo, sha: sha || '', mode: content.mode, note: '已把上游 ' + content.artifact + ' 记为基线' } }
  }
  if (content.mode === 'content' && content.sha && prev.content && content.sha !== prev.content) {
    return { stamp, next: { state: 'newer', repo, sha, mode: 'content', artifact: content.artifact, note: '上游 ' + content.artifact + ' 内容有变化' } }
  }
  if (content.mode === 'version') {
    const remoteVersion = semverOf(content.version)
    const baseVersion = semverOf(prev.version)
    if (remoteVersion && baseVersion && compareSemver(remoteVersion, baseVersion) > 0) {
      return {
        stamp,
        next: {
          state: 'newer',
          repo,
          sha,
          mode: 'version',
          latestVersion: content.version,
          artifact: content.artifact,
          note: '上游 package.json 版本更高',
        },
      }
    }
  }
  return { stamp, next: { state: 'current', repo, sha: sha || '', mode: content.mode, note: '上游 ' + content.artifact + ' 没变' } }
}

async function runCheck(force = false) {
  const list = await buildList()
  const fingerprint = checkFingerprint(list.items)
  const cached = await readJsonFile(CHECK_FILE, null)
  if (
    !force &&
    cached &&
    cached.fingerprint === fingerprint &&
    Number(cached.expiresAt || 0) > Date.now() &&
    cached.items
  ) {
    return { ...cached, cached: true }
  }
  const previous = cached && cached.baselines ? cached : { repos: {}, baselines: {}, items: {} }

  const wanted = new Map()
  for (const item of list.items) {
    const repo = repoFromSource(item.source)
    if (!repo) continue
    const pathHint = pathFromDeepLink(item.deepLink)
    if (!wanted.has(repo) || (pathHint && !wanted.get(repo))) wanted.set(repo, pathHint || '')
  }

  const repos = {}
  for (const [repo, pathHint] of [...wanted.entries()].slice(0, 40)) {
    repos[repo] = await checkRepo(repo, pathHint)
  }

  const baselines = { ...(previous.baselines || {}) }
  const items = {}
  for (const item of list.items) {
    const repo = repoFromSource(item.source)
    if (!repo) {
      items[item.key] = { state: 'no-source' }
      continue
    }
    // 先试内容比对：走 raw.githubusercontent.com 的 CDN，不占 API 限流，
    // 所以即使 api.github.com 已经限流，也照样能判断上游变没变。
    const directContent = await contentCompare(item, repo)
    if (directContent) {
      const applied = decideByContent(item, repo, directContent, baselines[item.key], '')
      if (applied.stamp) baselines[item.key] = applied.stamp
      items[item.key] = applied.next
      continue
    }
    const info = repos[repo]
    if (!info) {
      items[item.key] = { state: 'error', error: '这一轮没有查到该仓库', repo }
      continue
    }
    if (info.error) {
      items[item.key] = { state: 'error', error: info.error, repo }
      continue
    }
    const latest = semverOf(info.release)
    const local = semverOf(item.version)
    if (latest && local && compareSemver(latest, local) > 0) {
      items[item.key] = {
        state: 'newer',
        repo,
        latestTag: info.release,
        latestVersion: info.release.replace(/^v/i, ''),
        releaseAt: info.releaseAt,
        note: '上游发了新版本',
      }
      continue
    }
    const prev = baselines[item.key]
    if (!prev || prev.repo !== repo) {
      baselines[item.key] = { repo, sha: info.sha || '', at: info.checkedAt }
      items[item.key] = { state: 'baseline', repo, sha: info.sha || '', note: '已把当前上游提交记为基线' }
    } else if (info.sha && prev.sha && info.sha !== prev.sha) {
      items[item.key] = {
        state: 'newer',
        repo,
        sha: info.sha,
        message: info.message,
        checkedAt: info.checkedAt,
        note: '上游这个目录有了新提交',
      }
    } else {
      items[item.key] = { state: 'current', repo, sha: info.sha || '', note: '与记录的基线一致' }
    }
  }

  const self = await selfInfo()
  const limited =
    Object.values(repos)
      .map((info) => info.rateLimit)
      .find((r) => r && r.remaining === 0) || null
  const failed = Object.entries(items).filter(([, value]) => value.state === 'error')
  const payload = {
    repos,
    baselines,
    items,
    self,
    checkedAt: new Date().toISOString(),
    rateLimit: limited,
    errors: failed.length,
    errorSample: failed.length > 0 ? failed[0][1].error || '' : '',
    fingerprint,
    expiresAt: Date.now() + (failed.length > 0 || limited ? CHECK_ERROR_TTL_MS : CHECK_TTL_MS),
    cached: false,
  }
  await writeJsonFile(CHECK_FILE, payload)
  return payload
}

/** 本插件自身的版本比对：本地 package.json vs 仓库 main 分支的 package.json。 */
async function selfInfo() {
  let local = ''
  try {
    local = JSON.parse(await readFile(path.join(PLUGIN_DIR, 'package.json'), 'utf8')).version || ''
  } catch {
    local = ''
  }
  const res = await githubApi('/repos/' + SELF_REPO + '/contents/package.json?ref=' + SELF_BRANCH)
  let remote = ''
  if (res.ok && res.json?.content) {
    try {
      remote = JSON.parse(Buffer.from(res.json.content, 'base64').toString('utf8')).version || ''
    } catch {
      remote = ''
    }
  }
  const a = semverOf(remote)
  const b = semverOf(local)
  return {
    repo: SELF_REPO,
    local,
    remote,
    newer: Boolean(a && b && compareSemver(a, b) > 0),
    checkedAt: new Date().toISOString(),
  }
}

/** 递归列出一个目录下的相对路径（跳过 .git / node_modules）。 */
async function listLocalFiles(root, prefix = '') {
  const entries = await readdir(root, { withFileTypes: true })
  const out = []
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    const rel = prefix ? prefix + '/' + entry.name : entry.name
    if (entry.isDirectory()) out.push(...(await listLocalFiles(path.join(root, entry.name), rel)))
    else if (entry.isFile()) out.push(rel)
  }
  return out
}

/**
 * 校验暂存目录：必需文件齐全、所有 .json 可解析、所有脚本非空。
 * 真正的 ESM 语法只有加载时才验得了，所以这里只挡「半截文件 / 缺文件」这类硬伤。
 */
async function verifyStage(stage, blobs) {
  const required = ['package.json', 'index.js', 'client.js', 'cordis.patch.yml']
  for (const rel of required) {
    if (!blobs.some((blob) => blob.path === rel)) throw new Error('远端缺少必需文件：' + rel)
  }
  for (const blob of blobs) {
    const local = path.join(stage, ...blob.path.split('/'))
    if (blob.path.endsWith('.json')) {
      const text = await readFile(local, 'utf8')
      try {
        JSON.parse(text)
      } catch {
        throw new Error('下载到的 ' + blob.path + ' 不是合法 JSON')
      }
    } else if (/\.(m?js|cjs)$/.test(blob.path)) {
      const text = await readFile(local, 'utf8')
      if (text.trim().length === 0) throw new Error('下载到的 ' + blob.path + ' 是空文件')
    }
  }
}

/**
 * 用仓库 main 分支的文件覆盖本插件目录。
 * 顺序：整棵下载到暂存目录 → 校验 → 备份 → 覆盖 → 删除上游已不存在的文件。
 * 覆盖阶段任何一步失败都用备份还原，绝不留下新旧混搭的目录。
 */
async function selfUpdate() {
  const tree = await githubApi('/repos/' + SELF_REPO + '/git/trees/' + SELF_BRANCH + '?recursive=1')
  if (!tree.ok || !Array.isArray(tree.json?.tree)) throw new Error('读不到远端文件树：' + describeApiError(tree))
  const blobs = tree.json.tree.filter(
    (entry) => entry.type === 'blob' && !entry.path.split('/').some((part) => SKIP_DIRS.has(part)),
  )
  if (blobs.length === 0) throw new Error('远端文件树是空的')

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const stage = path.join(DSH_HOME, 'tmp', 'github-inventory-incoming-' + stamp)
  const backup = path.join(DSH_HOME, 'backups', 'github-inventory-' + stamp)

  try {
    for (const blob of blobs) {
      const apiPath =
        '/repos/' + SELF_REPO + '/contents/' + blob.path.split('/').map(encodeURIComponent).join('/') + '?ref=' + SELF_BRANCH
      const res = await githubApi(apiPath)
      if (!res.ok || !res.json?.content) throw new Error('下载失败：' + blob.path + '（' + describeApiError(res) + '）')
      const staged = path.join(stage, ...blob.path.split('/'))
      if (!staged.startsWith(stage + path.sep)) throw new Error('拒绝写入暂存目录之外：' + blob.path)
      await mkdir(path.dirname(staged), { recursive: true })
      await writeFile(staged, Buffer.from(res.json.content, 'base64'))
    }
    await verifyStage(stage, blobs)
  } catch (error) {
    await rm(stage, { recursive: true, force: true })
    throw new Error('下载阶段失败，本地文件未改动：' + error.message)
  }

  await cp(PLUGIN_DIR, backup, { recursive: true })
  let written = 0
  const removed = []
  try {
    for (const blob of blobs) {
      const from = path.join(stage, ...blob.path.split('/'))
      const to = path.join(PLUGIN_DIR, ...blob.path.split('/'))
      if (to !== PLUGIN_DIR && !to.startsWith(PLUGIN_DIR + path.sep)) throw new Error('拒绝写入插件目录之外：' + blob.path)
      await mkdir(path.dirname(to), { recursive: true })
      await cp(from, to, { force: true })
      written += 1
    }
    const keep = new Set(blobs.map((blob) => blob.path))
    for (const rel of await listLocalFiles(PLUGIN_DIR)) {
      if (keep.has(rel)) continue
      await rm(path.join(PLUGIN_DIR, ...rel.split('/')), { force: true })
      removed.push(rel)
    }
  } catch (error) {
    try {
      await cp(backup, PLUGIN_DIR, { recursive: true, force: true })
    } catch (restoreError) {
      throw new Error(
        '更新失败，且自动还原也失败（' + restoreError.message + '）。手动还原：把 ' + backup + ' 整个目录复制回 ' + PLUGIN_DIR,
      )
    }
    throw new Error('更新失败，已用备份还原：' + error.message)
  } finally {
    await rm(stage, { recursive: true, force: true })
  }

  const self = await selfInfo()
  return {
    ok: true,
    files: written,
    removed,
    backup,
    local: self.local,
    remote: self.remote,
    restartRequired: true,
  }
}

/* ---------------------------------------------------------------- restart */

const RESTART_LOG = path.join(os.tmpdir(), 'dsh-restart.log')

/** 桌面端才有可重启的应用进程：exe 由宿主进程的环境变量给出。 */
function restartTarget() {
  const installDir = String(process.env.DSH_INSTALL_DIR || '')
  const exe = String(process.env.DSH_NODE_EXECUTABLE || '')
  const desktop = /app\.asar/i.test(installDir) || /^DeepSeek Harness(\.exe)?$/i.test(path.basename(exe))
  return { desktop: desktop && Boolean(exe), exe }
}

const HELPER_SOURCE =
  [
    "const { spawn } = require('node:child_process')",
    "const fs = require('node:fs')",
    "const path = require('node:path')",
    "",
    "const hostPid = Number(process.env.GI_HOST_PID || 0)",
    "const exe = String(process.env.GI_EXE || '')",
    "const logFile = String(process.env.GI_LOG || '')",
    "",
    "function log(line) {",
    "  try {",
    "    fs.appendFileSync(logFile, new Date().toISOString() + ' ' + line + '\\n')",
    "  } catch (error) {",
    "    /* 日志写不进去也不影响重启 */",
    "  }",
    "}",
    "",
    "function alive(pid) {",
    "  if (!pid || pid <= 0) return false",
    "  try {",
    "    process.kill(pid, 0)",
    "    return true",
    "  } catch (error) {",
    "    return Boolean(error && error.code === 'EPERM')",
    "  }",
    "}",
    "",
    "function run(cmd, args) {",
    "  return new Promise(function (resolve) {",
    "    try {",
    "      const child = spawn(cmd, args, { stdio: 'ignore', windowsHide: true })",
    "      child.on('error', function () { resolve(false) })",
    "      child.on('exit', function (code) { resolve(code === 0) })",
    "    } catch (error) {",
    "      resolve(false)",
    "    }",
    "  })",
    "}",
    "",
    "function sleep(ms) {",
    "  return new Promise(function (resolve) { setTimeout(resolve, ms) })",
    "}",
    "",
    "/** 一次性拿全进程表：pid / 父 pid / 镜像路径 / 命令行。 */",
    "function snapshot() {",
    "  return new Promise(function (resolve) {",
    "    try {",
    "      const script =",
    "        'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress'",
    "      const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {",
    "        stdio: ['ignore', 'pipe', 'ignore'],",
    "        windowsHide: true,",
    "      })",
    "      let out = ''",
    "      child.stdout.on('data', function (chunk) { out += chunk })",
    "      child.on('error', function () { resolve([]) })",
    "      child.on('exit', function () {",
    "        try {",
    "          const parsed = JSON.parse(out)",
    "          resolve(Array.isArray(parsed) ? parsed : parsed ? [parsed] : [])",
    "        } catch (error) {",
    "          resolve([])",
    "        }",
    "      })",
    "    } catch (error) {",
    "      resolve([])",
    "    }",
    "  })",
    "}",
    "",
    "/** 沿父进程往上走，找到真正的那次「应用进程」：同一个 exe、且不是 --type= 子进程或 asar 内的宿主子进程。 */",
    "function chainOf(list, startPid) {",
    "  const byPid = new Map()",
    "  for (const entry of list) {",
    "    if (entry && entry.ProcessId) byPid.set(Number(entry.ProcessId), entry)",
    "  }",
    "  const chain = []",
    "  let cursor = Number(startPid) || 0",
    "  for (let i = 0; i < 12 && cursor > 0; i += 1) {",
    "    const entry = byPid.get(cursor)",
    "    if (!entry) break",
    "    chain.push(entry)",
    "    cursor = Number(entry.ParentProcessId) || 0",
    "  }",
    "  return chain",
    "}",
    "",
    "function sameExe(entry) {",
    "  const image = String((entry && entry.ExecutablePath) || '').trim()",
    "  if (!image || !exe) return false",
    "  return path.resolve(image).toLowerCase() === path.resolve(exe).toLowerCase()",
    "}",
    "",
    "function isAppRoot(entry) {",
    "  if (!sameExe(entry)) return false",
    "  const command = String((entry && entry.CommandLine) || '')",
    "  if (/--type=/i.test(command)) return false",
    "  if (/\\.asar/i.test(command)) return false",
    "  return true",
    "}",
    "",
    "async function main() {",
    "  log('helper start host=' + hostPid + ' exe=' + exe)",
    "  await sleep(800)",
    "  if (!exe) {",
    "    log('no exe path, abort')",
    "    return",
    "  }",
    "  const chain = chainOf(await snapshot(), hostPid)",
    "  log(",
    "    'chain: ' +",
    "      chain",
    "        .map(function (entry) {",
    "          return entry.ProcessId + ':' + path.basename(String(entry.ExecutablePath || '?'))",
    "        })",
    "        .join(' <- '),",
    "  )",
    "  const root = chain.filter(isAppRoot)[0]",
    "  if (!root) {",
    "    log('no app root among ancestors, abort')",
    "    return",
    "  }",
    "  const mainPid = Number(root.ProcessId)",
    "  log('app root pid=' + mainPid)",
    "",
    "  log('graceful quit app pid=' + mainPid)",
    "  await run('taskkill', ['/PID', String(mainPid)])",
    "  for (let i = 0; i < 32 && alive(mainPid); i += 1) await sleep(250)",
    "  if (alive(mainPid)) {",
    "    log('graceful quit failed, force kill app')",
    "    await run('taskkill', ['/F', '/PID', String(mainPid)])",
    "  }",
    "",
    "  for (let i = 0; i < 16 && alive(hostPid); i += 1) await sleep(250)",
    "  const leftovers = chain",
    "    .filter(function (entry) {",
    "      const pid = Number(entry.ProcessId)",
    "      return pid !== mainPid && sameExe(entry)",
    "    })",
    "    .map(function (entry) {",
    "      return Number(entry.ProcessId)",
    "    })",
    "  for (const pid of [hostPid].concat(leftovers)) {",
    "    if (pid && alive(pid)) {",
    "      log('force kill leftover pid=' + pid)",
    "      await run('taskkill', ['/F', '/PID', String(pid)])",
    "    }",
    "  }",
    "",
    "  await sleep(900)",
    "  log('relaunch ' + exe)",
    "  try {",
    "    const child = spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: false })",
    "    child.unref()",
    "    log('relaunched pid=' + child.pid)",
    "  } catch (error) {",
    "    log('relaunch failed: ' + (error && error.message))",
    "  }",
    "  await sleep(600)",
    "  try {",
    "    fs.unlinkSync(__filename)",
    "  } catch (error) {",
    "    /* 删不掉就留给临时目录清理 */",
    "  }",
    "  log('helper done')",
    "}",
    "",
    "main()",
  ].join("\n") + "\n"

let restarting = false

/**
 * 一键重启：写一个 detached 助手（本进程被杀之后它接着干活），
 * 助手沿父进程链找到真正的应用进程（同一个 exe、非 --type= 子进程、命令行里没有 .asar），
 * 先 taskkill（不带 /F，等于请它自己关窗退出），退不掉再 /F，最后重新拉起。
 */
async function restartDsh() {
  const target = restartTarget()
  if (!target.desktop) throw new Error('这个 DSH 不是桌面端，没有可重启的应用进程')
  if (restarting) return { ok: true, restarting: true, already: true }
  restarting = true
  const helperPath = path.join(os.tmpdir(), 'dsh-restart-' + Date.now().toString(36) + '.cjs')
  await writeFile(helperPath, HELPER_SOURCE, 'utf8')
  const child = spawn(target.exe, [helperPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      GI_MAIN_PID: String(process.ppid),
      GI_HOST_PID: String(process.pid),
      GI_EXE: target.exe,
      GI_LOG: RESTART_LOG,
    },
  })
  child.on('error', () => {
    restarting = false
  })
  child.unref()
  return {
    ok: true,
    restarting: true,
    hostPid: process.pid,
    helper: helperPath,
    log: RESTART_LOG,
  }
}

/* ---------------------------------------------------------------- http layer */

/** 把一条来源写回本机登记表（没有条目就新建），供详情卡「补充来源」用。 */
async function saveSource(key, source, downloadUrl) {
  const clean = String(source || '').trim()
  if (clean && !/^https?:\/\/\S+$/i.test(clean)) throw new Error('invalid source')
  if (clean.length > 500) throw new Error('source too long')
  const registry = await readJsonFile(REGISTRY_FILE, { items: [] })
  if (!Array.isArray(registry.items)) registry.items = []
  let entry = registry.items.find((e) => e && e.key === key)
  if (!entry) {
    entry = { key, kind: 'skill' }
    registry.items.push(entry)
  }
  const dl = String(downloadUrl || '').trim()
  if (clean) entry.source = clean
  else delete entry.source
  if (dl) entry.downloadUrl = dl
  else delete entry.downloadUrl
  await writeJsonFile(REGISTRY_FILE, registry)
  return { key, source: clean, downloadUrl: dl }
}

function writeJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  })
  res.end(JSON.stringify(body))
}

async function readJsonBody(req, maxBytes = 64 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) return {}
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}

function isLoopbackRequest(req) {
  const address = req.socket?.remoteAddress || ''
  const loopback = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
  if (!loopback) return false
  const host = String(req.headers?.host || '')
  const hostname = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  if (hostname && !['localhost', '127.0.0.1', '::1'].includes(hostname)) return false
  if (String(req.headers?.['sec-fetch-site'] || '') === 'cross-site') return false
  return true
}

/* ---------------------------------------------------------------- the plugin */

/** 仅供测试：把内部纯函数暴露出来，宿主运行时不会用到。 */
export const __internals = { rawUrl, rawGet, sha256, contentCompare }

export function apply(ctx) {
  const disposers = []

  disposers.push(
    ctx.webServer.register({
      kind: 'exact',
      path: API_LIST,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'loopback only' })
        try {
          writeJson(res, 200, await buildList())
        } catch (error) {
          writeJson(res, 500, { error: String(error?.message || error) })
        }
      },
    }),
  )

  disposers.push(
    ctx.webServer.register({
      kind: 'exact',
      path: API_SKILL,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'loopback only' })
        if ((req.method || 'POST') !== 'POST') return writeJson(res, 405, { error: 'method not allowed' })
        const body = await readJsonBody(req)
        const key = typeof body.key === 'string' ? body.key : ''
        const enabled = body.enabled === true
        try {
          const result = await setSkillEnabled(key, enabled)
          writeJson(res, 200, { ok: true, ...result })
        } catch (error) {
          writeJson(res, 400, { ok: false, error: String(error?.message || error) })
        }
      },
    }),
  )

  disposers.push(
    ctx.webServer.register({
      kind: 'exact',
      path: API_FAVORITE,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'loopback only' })
        if ((req.method || 'POST') !== 'POST') return writeJson(res, 405, { error: 'method not allowed' })
        const body = await readJsonBody(req)
        const key = typeof body.key === 'string' ? body.key : ''
        if (!key || key.length > 200 || /[\\/]/.test(key) || key.startsWith('.')) {
          return writeJson(res, 400, { ok: false, error: 'invalid key' })
        }
        try {
          writeJson(res, 200, { ok: true, ...(await setFavorite(key, body.favorite === true)) })
        } catch (error) {
          writeJson(res, 400, { ok: false, error: String(error?.message || error) })
        }
      },
    }),
  )

  disposers.push(
    ctx.webServer.register({
      kind: 'exact',
      path: API_SOURCE,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'loopback only' })
        if ((req.method || 'POST') !== 'POST') return writeJson(res, 405, { error: 'method not allowed' })
        const body = await readJsonBody(req)
        const key = typeof body.key === 'string' ? body.key : ''
        if (!key || key.length > 200 || /[\\/]/.test(key) || key.startsWith('.')) {
          return writeJson(res, 400, { ok: false, error: 'invalid key' })
        }
        try {
          writeJson(res, 200, { ok: true, ...(await saveSource(key, body.source, body.downloadUrl)) })
        } catch (error) {
          writeJson(res, 400, { ok: false, error: String(error?.message || error) })
        }
      },
    }),
  )

  disposers.push(
    ctx.webServer.register({
      kind: 'exact',
      path: API_CHECK,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'loopback only' })
        if ((req.method || 'POST') !== 'POST') return writeJson(res, 405, { error: 'method not allowed' })
        try {
          let body = {}
          try {
            body = (await readJsonBody(req)) || {}
          } catch {
            body = {}
          }
          const result = await runCheck(body.force === true)
          const newer = Object.values(result.items || {}).filter((v) => v.state === 'newer').length
          writeJson(res, 200, {
            ok: true,
            cached: result.cached === true,
            expiresAt: result.expiresAt || 0,
            checkedAt: result.checkedAt,
            repos: Object.keys(result.repos || {}).length,
            newer,
            errors: result.errors || 0,
            errorSample: result.errorSample || '',
            rateLimit: result.rateLimit || null,
            self: result.self,
            items: result.items,
          })
        } catch (error) {
          writeJson(res, 400, { ok: false, error: String(error?.message || error) })
        }
      },
    }),
  )

  disposers.push(
    ctx.webServer.register({
      kind: 'exact',
      path: API_SELF_UPDATE,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'loopback only' })
        if ((req.method || 'POST') !== 'POST') return writeJson(res, 405, { error: 'method not allowed' })
        try {
          writeJson(res, 200, await selfUpdate())
        } catch (error) {
          writeJson(res, 400, { ok: false, error: String(error?.message || error) })
        }
      },
    }),
  )

  disposers.push(
    ctx.webServer.register({
      kind: 'exact',
      path: API_RESTART,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'loopback only' })
        if ((req.method || 'POST') !== 'POST') return writeJson(res, 405, { error: 'method not allowed' })
        try {
          writeJson(res, 200, await restartDsh())
        } catch (error) {
          writeJson(res, 400, { ok: false, error: String(error?.message || error) })
        }
      },
    }),
  )

  ctx.effect(() => () => {
    for (const dispose of disposers) {
      try {
        dispose?.()
      } catch {
        // ignore
      }
    }
  })
}