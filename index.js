/**
 * dsh-github-inventory — host half.
 *
 * 扫描本机由 GitHub 装进来的东西（技能 / 命令行工具 / 插件包），
 * 供设置页「GitHub 下载」一页展示与开关。技能可开关（目录在 ~/.dsh/skills
 * 与 ~/.dsh/skills-disabled 之间搬动），其余只读展示。
 */
import { readFile, writeFile, mkdir, readdir, stat, rename, cp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
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
  const checks = await readJsonFile(CHECK_FILE, null)
  const updateOf = (key) => (checks?.items && checks.items[key] ? checks.items[key] : null)
  const linked = items.map((item) =>
    withLinks({
      ...item,
      favorite: favorites.has(item.key),
      kindLabel: KIND_LABELS[item.kind] || item.kind,
      update: updateOf(item.key),
    }),
  )

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
    },
    self: checks?.self || null,
    checksAt: checks?.checkedAt || '',
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
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url))
const SELF_REPO = 'loftspire/dsh-github-inventory'
const SELF_BRANCH = 'main'
const SKIP_DIRS = new Set(['.git', 'node_modules'])

const API_CHECK = '/api/github-inventory/check'
const API_SELF_UPDATE = '/api/github-inventory/self-update'

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

/** 只读的 GitHub REST 调用；404 视为正常空结果，不抛。 */
async function githubApi(apiPath) {
  const token = readToken()
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'dsh-github-inventory' }
  if (token) headers.authorization = 'Bearer ' + token
  try {
    const response = await fetch('https://api.github.com' + apiPath, {
      headers,
      signal: AbortSignal.timeout(15000),
    })
    if (response.status === 404) return { ok: false, status: 404, json: null }
    const json = await response.json().catch(() => null)
    return { ok: response.ok, status: response.status, json }
  } catch (error) {
    return { ok: false, status: 0, json: null, error: String(error?.message || error) }
  }
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
    out.error = commits.error || 'commits HTTP ' + commits.status
  }
  const release = await githubApi('/repos/' + repo + '/releases/latest')
  if (release.ok && release.json) {
    out.release = release.json.tag_name || ''
    out.releaseAt = release.json.published_at || ''
  }
  return out
}

/** 逐项比对上游：有 release 的比版本号，没有的比目标路径最新 commit 与本地基线。 */
async function runCheck() {
  const list = await buildList()
  const previous = await readJsonFile(CHECK_FILE, { repos: {}, baselines: {}, items: {} })

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
  const payload = { repos, baselines, items, self, checkedAt: new Date().toISOString() }
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

/** 用仓库 main 分支的文件覆盖本插件目录（先整目录备份），返回是否需要重启。 */
async function selfUpdate() {
  const tree = await githubApi('/repos/' + SELF_REPO + '/git/trees/' + SELF_BRANCH + '?recursive=1')
  if (!tree.ok || !Array.isArray(tree.json?.tree)) throw new Error('读不到远端文件树')
  const blobs = tree.json.tree.filter(
    (entry) => entry.type === 'blob' && !entry.path.split('/').some((part) => SKIP_DIRS.has(part)),
  )
  if (blobs.length === 0) throw new Error('远端文件树是空的')

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = path.join(DSH_HOME, 'backups', 'github-inventory-' + stamp)
  await cp(PLUGIN_DIR, backup, { recursive: true })

  let written = 0
  for (const blob of blobs) {
    const apiPath =
      '/repos/' + SELF_REPO + '/contents/' + blob.path.split('/').map(encodeURIComponent).join('/') + '?ref=' + SELF_BRANCH
    const res = await githubApi(apiPath)
    if (!res.ok || !res.json?.content) throw new Error('下载失败：' + blob.path)
    const target = path.join(PLUGIN_DIR, ...blob.path.split('/'))
    if (target !== PLUGIN_DIR && !target.startsWith(PLUGIN_DIR + path.sep)) throw new Error('拒绝写入插件目录之外：' + blob.path)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, Buffer.from(res.json.content, 'base64'))
    written += 1
  }

  const self = await selfInfo()
  return { ok: true, files: written, backup, local: self.local, remote: self.remote, restartRequired: true }
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
          const result = await runCheck()
          const newer = Object.values(result.items || {}).filter((v) => v.state === 'newer').length
          writeJson(res, 200, {
            ok: true,
            checkedAt: result.checkedAt,
            repos: Object.keys(result.repos || {}).length,
            newer,
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