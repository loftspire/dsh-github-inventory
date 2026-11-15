/**
 * dsh-github-inventory — client half.
 *
 * 设置页「GitHub 下载」：像插件市场那样按技能 / 命令行工具 / 插件包分组，
 * 顶部搜索 + 类型与状态筛选 + 排序，行可收藏、可开关（技能）、可跳 GitHub，
 * 点一行打开详情（它能干什么、本地位置、原仓库与下载页）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-github-inventory',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const KIND_LABEL = { skill: '技能', cli: '命令行工具', bundle: '插件包' }
    const KIND_ORDER = ['skill', 'cli', 'bundle']

    const CSS = `
.gi-root { container-type: inline-size; }
.gi-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.gi-h1 { font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary, #1f2329); margin: 0 0 4px; }
.gi-sub { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #646a73); margin: 0; max-width: 640px; }
.gi-btn { flex: none; height: 28px; padding: 0 12px; border-radius: 6px; cursor: pointer;
  font-size: 12px; color: var(--dsw-alias-label-primary, #1f2329);
  background: var(--dsw-alias-bg-layer-2, #f5f6f7);
  border: 1px solid var(--dsw-alias-border-l1, #e5e6eb); }
.gi-btn:hover { background: var(--dsw-alias-interactive-bg-hover, #eceef0); }
.gi-btn:disabled { opacity: .5; cursor: default; }

.gi-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 10px; }
.gi-search { position: relative; flex: 1 1 220px; min-width: 160px; }
.gi-search input { width: 100%; height: 30px; padding: 0 28px 0 30px; box-sizing: border-box;
  font-size: 12.5px; color: var(--dsw-alias-label-primary, #1f2329);
  background: var(--dsw-alias-bg-layer-1, #fff); border: 1px solid var(--dsw-alias-border-l1, #e5e6eb);
  border-radius: 6px; outline: none; }
.gi-search input::placeholder { color: var(--dsw-alias-label-tertiary, #8f959e); }
.gi-search input:focus { border-color: var(--dsw-alias-brand-primary, #3370ff); }
.gi-search .gi-mag { position: absolute; left: 9px; top: 50%; transform: translateY(-50%);
  font-size: 12px; color: var(--dsw-alias-label-tertiary, #8f959e); pointer-events: none; }
.gi-search .gi-clear { position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
  width: 20px; height: 20px; border: none; background: transparent; cursor: pointer; font-size: 13px;
  line-height: 1; color: var(--dsw-alias-label-tertiary, #8f959e); border-radius: 4px; }
.gi-search .gi-clear:hover { background: var(--dsw-alias-bg-layer-3, #eef0f2); }

.gi-seg { display: inline-flex; padding: 2px; gap: 2px; border-radius: 7px;
  background: var(--dsw-alias-bg-layer-2, #f5f6f7); border: 1px solid var(--dsw-alias-border-l1, #e5e6eb); }
.gi-seg button { height: 24px; padding: 0 10px; border: none; border-radius: 5px; cursor: pointer;
  font-size: 12px; background: transparent; color: var(--dsw-alias-label-secondary, #646a73);
  font-variant-numeric: tabular-nums; }
.gi-seg button[data-active="true"] { background: var(--dsw-alias-bg-layer-1, #fff);
  color: var(--dsw-alias-label-primary, #1f2329); box-shadow: 0 1px 2px rgba(0,0,0,.08); font-weight: 600; }
.gi-seg button:hover:not([data-active="true"]) { color: var(--dsw-alias-label-primary, #1f2329); }

.gi-select { height: 30px; padding: 0 8px; border-radius: 6px; cursor: pointer; font-size: 12px;
  color: var(--dsw-alias-label-primary, #1f2329); background: var(--dsw-alias-bg-layer-1, #fff);
  border: 1px solid var(--dsw-alias-border-l1, #e5e6eb); }

.gi-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.gi-chip { font-size: 11px; padding: 3px 9px; border-radius: 999px;
  color: var(--dsw-alias-label-secondary, #646a73);
  background: var(--dsw-alias-bg-layer-2, #f5f6f7);
  border: 1px solid var(--dsw-alias-border-l1, #e5e6eb); }
.gi-chip b { color: var(--dsw-alias-label-primary, #1f2329); font-weight: 600; }
.gi-chip.warn { color: var(--dsw-alias-state-warn-primary, #b26b00); background: rgba(178,107,0,.08);
  border-color: rgba(178,107,0,.25); }
.gi-banner { display: flex; gap: 10px; align-items: flex-start; font-size: 12px; line-height: 1.6;
  padding: 10px 12px; margin-bottom: 14px; border-radius: 8px;
  color: var(--dsw-alias-label-secondary, #646a73);
  background: var(--dsw-alias-bg-layer-2, #f5f6f7);
  border: 1px solid var(--dsw-alias-border-l1, #e5e6eb); }
.gi-banner b { color: var(--dsw-alias-label-primary, #1f2329); }

.gi-group { margin-bottom: 18px; }
.gi-group-title { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600;
  color: var(--dsw-alias-label-secondary, #646a73); margin: 0 0 8px; }
.gi-group-title span { font-weight: 400; color: var(--dsw-alias-label-tertiary, #8f959e); }
.gi-card { border: 1px solid var(--dsw-alias-border-l1, #e5e6eb); border-radius: 8px; overflow: hidden;
  background: var(--dsw-alias-bg-layer-1, #fff); }
.gi-row { display: flex; gap: 14px; align-items: flex-start; padding: 12px 14px; cursor: pointer;
  transition: background .12s ease; outline: none; }
.gi-row + .gi-row { border-top: 1px solid var(--dsw-alias-border-l1, #e5e6eb); }
.gi-row:hover, .gi-row:focus-visible { background: var(--dsw-alias-interactive-bg-hover, #f2f4f7); }
.gi-row.off .gi-main { opacity: .55; }
.gi-main { min-width: 0; flex: 1; }
.gi-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.gi-name { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary, #1f2329); }
.gi-badge { font-size: 10px; padding: 1px 6px; border-radius: 4px; font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-secondary, #646a73); background: var(--dsw-alias-bg-layer-3, #eef0f2); }
.gi-badge.off { color: var(--dsw-alias-state-warn-primary, #b26b00); background: rgba(178,107,0,.1); }
.gi-badge.local { color: var(--dsw-alias-label-tertiary, #8f959e); background: transparent;
  border: 1px solid var(--dsw-alias-border-l1, #e5e6eb); }
.gi-badge.prov-catalog { color: var(--dsw-alias-brand-primary, #3370ff); background: rgba(51,112,255,.1); }
.gi-badge.prov-git, .gi-badge.prov-marker, .gi-badge.prov-header {
  color: var(--dsw-alias-state-success-primary, #1f7a3f); background: rgba(31,122,63,.1); }
.gi-badge.prov-inferred { color: var(--dsw-alias-state-warn-primary, #b26b00); background: rgba(178,107,0,.1); }
.gi-badge.prov-unknown { color: var(--dsw-alias-label-tertiary, #8f959e); background: transparent;
  border: 1px dashed var(--dsw-alias-border-l1, #e5e6eb); }
.gi-hint { margin-top: 6px; font-size: 11px; line-height: 1.6; color: var(--dsw-alias-label-tertiary, #8f959e); }
.gi-src { display: flex; gap: 8px; margin-top: 8px; align-items: center; }
.gi-input { flex: 1 1 auto; min-width: 0; height: 30px; padding: 0 10px; font-size: 12px; border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l1, #e5e6eb); background: var(--dsw-alias-bg-layer-1, #fff);
  color: var(--dsw-alias-label-primary, #1f2329); }
.gi-input:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #3370ff); }
.gi-meta { margin-top: 3px; font-size: 11px; color: var(--dsw-alias-label-tertiary, #8f959e);
  display: flex; gap: 8px; flex-wrap: wrap; }
.gi-desc { margin-top: 6px; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #646a73);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.gi-side { flex: none; padding-top: 2px; display: flex; align-items: center; gap: 8px; }
.gi-ro { font-size: 11px; color: var(--dsw-alias-label-tertiary, #8f959e); white-space: nowrap; }
.gi-icon-btn { width: 22px; height: 22px; border-radius: 5px; display: flex; align-items: center; justify-content: center;
  border: 1px solid transparent; background: transparent; cursor: pointer;
  color: var(--dsw-alias-label-tertiary, #8f959e); font-size: 12px; line-height: 1; }
.gi-icon-btn:hover { background: var(--dsw-alias-bg-layer-3, #eef0f2); color: var(--dsw-alias-brand-primary, #3370ff); }
.gi-jump { opacity: 0; transition: opacity .12s ease, background .12s ease, color .12s ease; }
.gi-row:hover .gi-jump, .gi-row:focus-within .gi-jump { opacity: 1; }
.gi-star { color: transparent; font-size: 13px; -webkit-text-stroke: 1px var(--dsw-alias-label-tertiary, #8f959e); }
.gi-star[data-on="true"] { color: var(--dsw-alias-state-warn-primary, #e8a33d); -webkit-text-stroke: 0; }
.gi-star:hover { color: var(--dsw-alias-state-warn-primary, #e8a33d); -webkit-text-stroke: 0; }
.gi-switch { width: 36px; height: 20px; border-radius: 999px; position: relative; cursor: pointer; padding: 0; flex: none;
  border: 1px solid var(--dsw-alias-border-l2, #d0d3d6); background: var(--dsw-alias-bg-layer-3, #eef0f2);
  transition: background .16s ease, border-color .16s ease; }
.gi-switch[data-on="true"] { background: var(--dsw-alias-brand-primary, #3370ff); border-color: var(--dsw-alias-brand-primary, #3370ff); }
.gi-switch:disabled { opacity: .5; cursor: default; }
.gi-knob { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.18); transition: transform .16s ease; }
.gi-switch[data-on="true"] .gi-knob { transform: translateX(16px); }
.gi-empty, .gi-status { font-size: 12px; color: var(--dsw-alias-label-tertiary, #8f959e);
  padding: 18px; text-align: center; border: 1px dashed var(--dsw-alias-border-l1, #e5e6eb); border-radius: 8px; }
.gi-empty b { color: var(--dsw-alias-label-primary, #1f2329); }
.gi-error { font-size: 12px; color: var(--dsw-alias-state-error-primary, #d83931); padding: 12px 14px;
  border: 1px solid var(--dsw-alias-state-error-primary, #d83931); border-radius: 8px; margin-bottom: 12px; }
.gi-foot { margin-top: 14px; font-size: 11px; line-height: 1.7; color: var(--dsw-alias-label-tertiary, #8f959e); }

.gi-backdrop { position: fixed; inset: 0; z-index: 3000; display: flex; align-items: center; justify-content: center;
  padding: 24px; background: rgba(15, 18, 22, .38); backdrop-filter: blur(2px); }
.gi-modal { width: 100%; max-width: 620px; max-height: 82vh; display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-layer-1, #fff); border: 1px solid var(--dsw-alias-border-l1, #e5e6eb);
  border-radius: 12px; box-shadow: 0 18px 48px rgba(0,0,0,.22); overflow: hidden; }
.gi-modal-head { display: flex; align-items: flex-start; gap: 12px; padding: 16px 18px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, #e5e6eb); }
.gi-modal-title { flex: 1; min-width: 0; }
.gi-modal-name { font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary, #1f2329);
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.gi-modal-sub { margin-top: 4px; font-size: 11px; color: var(--dsw-alias-label-tertiary, #8f959e); }
.gi-close { flex: none; width: 26px; height: 26px; border-radius: 6px; border: 1px solid transparent; background: transparent;
  color: var(--dsw-alias-label-secondary, #646a73); font-size: 16px; line-height: 1; cursor: pointer; }
.gi-close:hover { background: var(--dsw-alias-bg-layer-3, #eef0f2); }
.gi-modal-body { padding: 14px 18px 16px; overflow: auto; }
.gi-block { margin-bottom: 14px; }
.gi-label { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-tertiary, #8f959e); margin-bottom: 5px; }
.gi-text { font-size: 12.5px; line-height: 1.72; color: var(--dsw-alias-label-secondary, #646a73); white-space: pre-wrap; }
.gi-path { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11.5px; line-height: 1.6;
  padding: 8px 10px; border-radius: 6px; word-break: break-all;
  color: var(--dsw-alias-label-secondary, #646a73); background: var(--dsw-alias-bg-layer-2, #f5f6f7);
  border: 1px solid var(--dsw-alias-border-l1, #e5e6eb); }
.gi-kv { display: grid; grid-template-columns: 76px 1fr; gap: 6px 10px; font-size: 12px; }
.gi-kv .k { color: var(--dsw-alias-label-tertiary, #8f959e); }
.gi-kv .v { color: var(--dsw-alias-label-primary, #1f2329); word-break: break-all; }
.gi-modal-foot { display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
  padding: 12px 18px 16px; border-top: 1px solid var(--dsw-alias-border-l1, #e5e6eb); }
.gi-primary, .gi-secondary { height: 30px; padding: 0 14px; border-radius: 6px; font-size: 12px;
  display: inline-flex; align-items: center; gap: 6px; text-decoration: none; cursor: pointer; }
.gi-primary { color: var(--dsw-alias-fg-on-accent, #fff); background: var(--dsw-alias-brand-primary, #3370ff);
  border: 1px solid var(--dsw-alias-brand-primary, #3370ff); }
.gi-primary:hover { filter: brightness(1.06); }
.gi-secondary { color: var(--dsw-alias-label-primary, #1f2329); background: var(--dsw-alias-bg-layer-2, #f5f6f7);
  border: 1px solid var(--dsw-alias-border-l1, #e5e6eb); }
.gi-secondary:hover { background: var(--dsw-alias-interactive-bg-hover, #eceef0); }
.gi-modal-note { margin-left: auto; font-size: 11px; color: var(--dsw-alias-label-tertiary, #8f959e); }
.gi-badge.upd { color: var(--dsw-alias-state-success-primary, #2ea121); background: rgba(46,161,33,.12); }
.gi-badge.stale { color: var(--dsw-alias-label-tertiary, #8f959e); background: transparent; }
.gi-chip.upd { color: var(--dsw-alias-state-success-primary, #2ea121); background: rgba(46,161,33,.1); }
.gi-chip.upd b { color: var(--dsw-alias-state-success-primary, #2ea121); }
.gi-banner.self { border-color: rgba(46,161,33,.45); background: rgba(46,161,33,.06); }
.gi-banner .gi-btn { margin-left: auto; flex: none; }
.gi-upd { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; line-height: 1.6;
  color: var(--dsw-alias-label-secondary, #646a73); }
.gi-upd .ok { color: var(--dsw-alias-state-success-primary, #2ea121); }
.gi-upd .muted { color: var(--dsw-alias-label-tertiary, #8f959e); }
`

    function useStyles() {
      React.useEffect(() => {
        const id = 'gi-styles'
        const existing = document.getElementById(id)
        if (existing) {
          existing.textContent = CSS
          return
        }
        const el = document.createElement('style')
        el.id = id
        el.textContent = CSS
        document.head.appendChild(el)
      }, [])
    }

    function copyText(text) {
      const value = String(text || '')
      if (!value) return Promise.resolve(false)
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(value).then(() => true, () => false)
      }
      try {
        const area = document.createElement('textarea')
        area.value = value
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(area)
        return Promise.resolve(ok)
      } catch {
        return Promise.resolve(false)
      }
    }

    function initials(title, key) {
      const source = String(title || key || '?').trim()
      const ascii = /^[A-Za-z0-9]/.test(source)
      if (ascii) return source.charAt(0).toUpperCase()
      return source.slice(0, 2)
    }

    function Avatar(props) {
      return h(
        'div',
        {
          style: {
            flex: 'none',
            width: 36,
            height: 36,
            borderRadius: 9,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--dsw-alias-brand-primary, #3370ff)',
            background: 'color-mix(in srgb, var(--dsw-alias-brand-primary, #3370ff) 12%, transparent)',
          },
        },
        initials(props.title, props.key),
      )
    }

    function Switch(props) {
      const { checked, busy, onChange } = props
      return h(
        'button',
        {
          type: 'button',
          className: 'gi-switch',
          'data-on': checked ? 'true' : 'false',
          role: 'switch',
          'aria-checked': checked ? 'true' : 'false',
          'aria-label': checked ? '停用' : '启用',
          disabled: Boolean(busy),
          onClick: (event) => {
            event.stopPropagation()
            onChange(!checked)
          },
        },
        h('span', { className: 'gi-knob' }),
      )
    }

    function Star(props) {
      const { on, busy, onClick } = props
      return h(
        'button',
        {
          type: 'button',
          className: 'gi-icon-btn gi-star',
          'data-on': on ? 'true' : 'false',
          title: on ? '取消收藏' : '收藏',
          'aria-label': on ? '取消收藏' : '收藏',
          'aria-pressed': on ? 'true' : 'false',
          disabled: Boolean(busy),
          onClick: (event) => {
            event.stopPropagation()
            onClick()
          },
        },
        '★',
      )
    }

    function Row(props) {
      const { item, busy, onToggle, onOpen, onStar } = props
      const meta = []
      if (item.installedAt) meta.push(item.installedAt)
      if (item.root) meta.push(item.root)
      if (item.version) meta.push('v' + item.version)
      if (item.kind === 'skill' && item.files) meta.push(item.files + ' 个条目')

      const jump = item.downloadUrl || item.repoUrl || ''

      return h(
        'div',
        {
          className: 'gi-row' + (item.enabled ? '' : ' off'),
          role: 'button',
          tabIndex: 0,
          'aria-label': item.title || item.key,
          onClick: () => onOpen(item),
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onOpen(item)
            }
          },
        },
        h(Avatar, { title: item.title, key: item.key }),
        h(
          'div',
          { className: 'gi-main' },
          h(
            'div',
            { className: 'gi-title' },
            h('span', { className: 'gi-name' }, item.title || item.key),
            item.version ? h('span', { className: 'gi-badge' }, 'v' + item.version) : null,
            item.update && item.update.state === 'newer'
              ? h(
                  'span',
                  { className: 'gi-badge upd', title: item.update.note || '' },
                  item.update.latestVersion ? '可更新 ' + item.update.latestVersion : '有更新',
                )
              : null,
            item.kind === 'skill' && !item.enabled ? h('span', { className: 'gi-badge off' }, '已停用') : null,
            item.provenance && item.provenance !== 'registry'
              ? h(
                  'span',
                  { className: 'gi-badge prov-' + item.provenance, title: item.repoUrl || '' },
                  item.provenanceLabel || item.provenance,
                )
              : null,
          ),
          h('div', { className: 'gi-meta' }, meta.map((part, i) => h('span', { key: i }, part))),
          item.summary ? h('div', { className: 'gi-desc' }, item.summary) : null,
        ),
        h(
          'div',
          { className: 'gi-side' },
          h(Star, { on: Boolean(item.favorite), busy: busy === 'star:' + item.key, onClick: () => onStar(item) }),
          jump
            ? h(
                'a',
                {
                  className: 'gi-icon-btn gi-jump',
                  href: jump,
                  target: '_blank',
                  rel: 'noreferrer noopener',
                  title: '在 GitHub 打开',
                  onClick: (event) => event.stopPropagation(),
                },
                '↗',
              )
            : null,
          item.toggleable
            ? h(Switch, {
                checked: item.enabled,
                busy: busy === item.key,
                onChange: (next) => onToggle(item, next),
              })
            : h('span', { className: 'gi-ro' }, item.kind === 'bundle' ? '插件页管理' : '只读'),
        ),
      )
    }

    function Group(props) {
      const { kind, items, busy, onToggle, onOpen, onStar } = props
      if (items.length === 0) return null
      return h(
        'section',
        { className: 'gi-group' },
        h('h3', { className: 'gi-group-title' }, KIND_LABEL[kind] || kind, h('span', null, items.length + ' 项')),
        h(
          'div',
          { className: 'gi-card' },
          items.map((item) => h(Row, { key: item.id, item, busy, onToggle, onOpen, onStar })),
        ),
      )
    }

    function Detail(props) {
      const { item, onClose, onStar, onToggle, busy, onSaved } = props
      const [copied, setCopied] = React.useState('')
      const [srcInput, setSrcInput] = React.useState('')
      const [srcMsg, setSrcMsg] = React.useState('')
      const [srcBusy, setSrcBusy] = React.useState(false)

      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])

      const repo = item.repoUrl || ''
      const download = item.downloadUrl || ''
      const primaryHref = download || repo
      const primaryLabel = !download || download === repo ? '打开 GitHub 页面' : '打开下载页'

      const kv = [
        ['类型', KIND_LABEL[item.kind] || item.kind],
        item.version ? ['版本', item.version] : null,
        item.installedAt ? ['安装于', item.installedAt] : null,
        item.root ? ['所在位置', item.root] : null,
        item.kind === 'skill' && item.files ? ['目录条目', item.files + ' 个'] : null,
        ['来源', item.provenanceLabel || '未知'],
        item.update ? ['更新', updateLabel(item.update)] : null,
      ].filter(Boolean)

      return h(
        'div',
        {
          className: 'gi-backdrop',
          onClick: (event) => {
            if (event.target === event.currentTarget) onClose()
          },
        },
        h(
          'div',
          { className: 'gi-modal', role: 'dialog', 'aria-modal': 'true' },
          h(
            'div',
            { className: 'gi-modal-head' },
            h(Avatar, { title: item.title, key: item.key }),
            h(
              'div',
              { className: 'gi-modal-title' },
              h(
                'div',
                { className: 'gi-modal-name' },
                item.title || item.key,
                item.version ? h('span', { className: 'gi-badge' }, 'v' + item.version) : null,
                item.kind === 'skill' && !item.enabled ? h('span', { className: 'gi-badge off' }, '已停用') : null,
              ),
              h(
                'div',
                { className: 'gi-modal-sub' },
                repo ? repo.replace(/^https?:\/\/(www\.)?/, '') : '没有来源记录（可在下方补充）',
              ),
            ),
            h('button', { className: 'gi-close', type: 'button', onClick: onClose, 'aria-label': '关闭' }, '×'),
          ),
          h(
            'div',
            { className: 'gi-modal-body' },
            h(
              'div',
              { className: 'gi-block' },
              h('div', { className: 'gi-label' }, '它能干什么'),
              h('div', { className: 'gi-text' }, item.summaryFull || item.summary || '（登记表里没写说明）'),
            ),
            h(
              'div',
              { className: 'gi-block' },
              h(
                'div',
                { className: 'gi-kv' },
                kv.map(([k, v]) => [
                  h('div', { className: 'k', key: k }, k),
                  h('div', { className: 'v', key: k + '-v' }, v),
                ]),
              ),
            ),
            item.provenance === 'unknown' || item.provenance === 'inferred'
              ? h(
                  'div',
                  { className: 'gi-block' },
                  h('div', { className: 'gi-label' }, '补充来源'),
                  h(
                    'div',
                    { className: 'gi-hint' },
                    '填一个 GitHub 仓库地址，会写进本机登记表，之后列表与详情都能直接跳转。',
                  ),
                  h(
                    'div',
                    { className: 'gi-src' },
                    h('input', {
                      className: 'gi-input',
                      placeholder: 'https://github.com/owner/repo',
                      value: srcInput,
                      spellCheck: false,
                      onChange: (event) => setSrcInput(event.target.value),
                      onKeyDown: (event) => {
                        if (event.key === 'Enter') event.currentTarget.blur()
                      },
                    }),
                    h(
                      'button',
                      {
                        className: 'gi-secondary',
                        type: 'button',
                        disabled: srcBusy,
                        onClick: async () => {
                          const value = srcInput.trim()
                          if (!/^https?:\/\/\S+$/i.test(value)) {
                            setSrcMsg('要一个 http(s) 地址')
                            return
                          }
                          setSrcBusy(true)
                          setSrcMsg('')
                          try {
                            const response = await fetch('/api/github-inventory/source', {
                              method: 'POST',
                              credentials: 'same-origin',
                              headers: { 'content-type': 'application/json' },
                              body: JSON.stringify({ key: item.key, source: value }),
                            })
                            const data = await response.json().catch(() => ({}))
                            if (!response.ok || data.ok === false) throw new Error(data.error || '保存失败')
                            setSrcMsg('已保存')
                            if (onSaved) {
                              onSaved({
                                source: value,
                                repoUrl: value,
                                downloadUrl: value,
                                provenance: 'registry',
                                provenanceLabel: '已登记',
                                registered: true,
                              })
                            }
                          } catch (error) {
                            setSrcMsg('没保存：' + String((error && error.message) || error))
                          } finally {
                            setSrcBusy(false)
                          }
                        },
                      },
                      srcBusy ? '保存中…' : '保存',
                    ),
                  ),
                  srcMsg ? h('div', { className: 'gi-hint' }, srcMsg) : null,
                )
              : null,
            item.location
              ? h(
                  'div',
                  { className: 'gi-block' },
                  h('div', { className: 'gi-label' }, '文件位置'),
                  h('div', { className: 'gi-path' }, item.location),
                )
              : null,
          ),
          h(
            'div',
            { className: 'gi-modal-foot' },
            primaryHref
              ? h(
                  'a',
                  { className: 'gi-primary', href: primaryHref, target: '_blank', rel: 'noreferrer noopener' },
                  primaryLabel,
                  ' ↗',
                )
              : null,
            repo && download && repo !== download
              ? h(
                  'a',
                  { className: 'gi-secondary', href: repo, target: '_blank', rel: 'noreferrer noopener' },
                  '打开仓库 ↗',
                )
              : null,
            item.location
              ? h(
                  'button',
                  {
                    className: 'gi-secondary',
                    type: 'button',
                    onClick: async () => {
                      const ok = await copyText(item.location)
                      setCopied(ok ? '路径已复制' : '复制失败，请手动选中')
                      setTimeout(() => setCopied(''), 2000)
                    },
                  },
                  copied || '复制本地路径',
                )
              : null,
            h(
              'button',
              {
                className: 'gi-secondary',
                type: 'button',
                onClick: () => onStar(item),
              },
              item.favorite ? '★ 已收藏' : '☆ 收藏',
            ),
            item.toggleable
              ? h(
                  'button',
                  {
                    className: 'gi-secondary',
                    type: 'button',
                    disabled: busy === item.key,
                    onClick: () => onToggle(item, !item.enabled),
                  },
                  item.enabled ? '停用' : '启用',
                )
              : null,
            h('span', { className: 'gi-modal-note' }, 'Esc 关闭'),
          ),
        ),
      )
    }

    function updateLabel(u) {
      if (!u) return ''
      const when = u.checkedAt ? new Date(u.checkedAt).toLocaleString('zh-CN') : ''
      if (u.state === 'newer') {
        if (u.latestVersion) {
          const at = u.releaseAt ? '（' + new Date(u.releaseAt).toLocaleDateString('zh-CN') + ' 发布）' : ''
          return '有新版本 ' + u.latestVersion + at
        }
        return (u.note || '上游有新的提交') + (u.message ? '：' + u.message : '')
      }
      if (u.state === 'current') return '已是最新' + (when ? '（' + when + '）' : '')
      if (u.state === 'baseline') return '已记录基线，下次检查开始比对'
      if (u.state === 'no-source') return '没有上游地址，无法检查'
      if (u.state === 'error') return '检查失败：' + (u.error || '未知错误')
      return u.note || ''
    }

    function matches(item, query) {
      if (!query) return true
      const hay = [item.title, item.key, item.summary, item.summaryFull, item.source, item.version, item.root]
        .join(' ')
        .toLowerCase()
      return hay.includes(query)
    }

    function Page() {
      useStyles()
      const [state, setState] = React.useState({ status: 'loading', data: null, error: '' })
      const [busy, setBusy] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [selected, setSelected] = React.useState(null)
      const [query, setQuery] = React.useState('')
      const [kind, setKind] = React.useState('all')
      const [status, setStatus] = React.useState('all')
      const [sort, setSort] = React.useState('date')
      const [checkBusy, setCheckBusy] = React.useState(false)
      const [selfBusy, setSelfBusy] = React.useState(false)
      const searchRef = React.useRef(null)

      const load = React.useCallback(async () => {
        setState((prev) => ({ ...prev, status: prev.data ? 'refreshing' : 'loading', error: '' }))
        try {
          const response = await fetch('/api/github-inventory/list', { credentials: 'same-origin' })
          if (!response.ok) throw new Error('HTTP ' + response.status)
          const data = await response.json()
          setState({ status: 'ready', data, error: '' })
        } catch (error) {
          setState((prev) => ({ ...prev, status: 'error', error: String((error && error.message) || error) }))
        }
      }, [])

      React.useEffect(() => {
        load()
      }, [load])

      React.useEffect(() => {
        const onKey = (event) => {
          const target = event.target
          const typing =
            target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
          if (event.key === '/' && !typing) {
            event.preventDefault()
            if (searchRef.current) searchRef.current.focus()
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [])

      const patchItem = React.useCallback((key, patch) => {
        setState((prev) =>
          prev.data
            ? {
                ...prev,
                data: { ...prev.data, items: prev.data.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) },
              }
            : prev,
        )
      }, [])

      const onToggle = React.useCallback(
        async (item, next) => {
          setBusy(item.key)
          setNotice('')
          try {
            const response = await fetch('/api/github-inventory/skill', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ key: item.key, enabled: next }),
            })
            const result = await response.json().catch(() => ({}))
            if (!response.ok || !result.ok) throw new Error(result.error || 'HTTP ' + response.status)
            setNotice((next ? '已启用 ' : '已停用 ') + item.title + '：本会话技能目录即时生效。')
            await load()
          } catch (error) {
            setState((prev) => ({ ...prev, error: String((error && error.message) || error) }))
          } finally {
            setBusy('')
          }
        },
        [load],
      )

      const onStar = React.useCallback(
        async (item) => {
          const next = !item.favorite
          patchItem(item.key, { favorite: next })
          setBusy('star:' + item.key)
          try {
            const response = await fetch('/api/github-inventory/favorite', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ key: item.key, favorite: next }),
            })
            const result = await response.json().catch(() => ({}))
            if (!response.ok || !result.ok) throw new Error(result.error || 'HTTP ' + response.status)
          } catch (error) {
            patchItem(item.key, { favorite: !next })
            setState((prev) => ({ ...prev, error: '收藏没保存：' + String((error && error.message) || error) }))
          } finally {
            setBusy('')
          }
        },
        [patchItem],
      )

      const onCheck = React.useCallback(async () => {
        setCheckBusy(true)
        setNotice('')
        try {
          const response = await fetch('/api/github-inventory/check', { method: 'POST', credentials: 'same-origin' })
          const result = await response.json().catch(() => ({}))
          if (!response.ok || !result.ok) throw new Error(result.error || 'HTTP ' + response.status)
          await load()
          setNotice(
            result.newer
              ? '检查完成：' + result.newer + ' 项有新版本（查了 ' + result.repos + ' 个仓库，' + new Date(result.checkedAt).toLocaleTimeString('zh-CN') + '）'
              : '检查完成：没有发现新版本（查了 ' + result.repos + ' 个仓库）',
          )
        } catch (error) {
          setState((prev) => ({ ...prev, error: '检查更新失败：' + String((error && error.message) || error) }))
        } finally {
          setCheckBusy(false)
        }
      }, [load])

      const onSelfUpdate = React.useCallback(async () => {
        setSelfBusy(true)
        setNotice('')
        try {
          const response = await fetch('/api/github-inventory/self-update', { method: 'POST', credentials: 'same-origin' })
          const result = await response.json().catch(() => ({}))
          if (!response.ok || !result.ok) throw new Error(result.error || 'HTTP ' + response.status)
          setNotice(
            '插件已更新到 ' + (result.remote || '?') + '（写了 ' + result.files + ' 个文件，旧版备份在 ' + result.backup + '）。重启 DSH 后生效。',
          )
          await load()
        } catch (error) {
          setState((prev) => ({ ...prev, error: '更新插件失败：' + String((error && error.message) || error) }))
        } finally {
          setSelfBusy(false)
        }
      }, [load])

      const data = state.data
      const items = (data && data.items) || []
      const q = query.trim().toLowerCase()

      const visible = React.useMemo(() => {
        let list = items.filter((item) => (kind === 'all' ? true : item.kind === kind))
        if (status === 'on') list = list.filter((i) => i.enabled)
        else if (status === 'off') list = list.filter((i) => !i.enabled)
        else if (status === 'unregistered') list = list.filter((i) => !i.registered)
        else if (status === 'favorite') list = list.filter((i) => i.favorite)
        else if (status === 'updatable') list = list.filter((i) => i.update && i.update.state === 'newer')
        list = list.filter((item) => matches(item, q))
        const sorted = [...list]
        if (sort === 'name') sorted.sort((a, b) => String(a.title || a.key).localeCompare(String(b.title || b.key)))
        else if (sort === 'installed')
          sorted.sort((a, b) => String(b.installedAt || '').localeCompare(String(a.installedAt || '')))
        else
          sorted.sort(
            (a, b) =>
              KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
              String(a.title || a.key).localeCompare(String(b.title || b.key)),
          )
        return sorted
      }, [items, kind, status, q, sort])

      const grouped = React.useMemo(() => {
        const out = { skill: [], cli: [], bundle: [] }
        for (const item of visible) (out[item.kind] || (out[item.kind] = [])).push(item)
        return out
      }, [visible])

      const seg = (id, label, count) =>
        h(
          'button',
          {
            key: id,
            type: 'button',
            'data-active': kind === id ? 'true' : 'false',
            onClick: () => setKind(id),
          },
          label + (count == null ? '' : ' ' + count),
        )

      const filtering = Boolean(q) || kind !== 'all' || status !== 'all'

      return h(
        'div',
        { className: 'gi-root' },
        h(
          'div',
          { className: 'gi-head' },
          h(
            'div',
            null,
            h('h2', { className: 'gi-h1' }, 'GitHub 下载'),
            h(
              'p',
              { className: 'gi-sub' },
              '从 GitHub 仓库装进这台机器的技能、命令行工具与插件包。支持搜索与筛选，点一行看它能干什么、本地在哪、原页面在哪；技能可直接开关。',
            ),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 8, flex: 'none' } },
            h(
              'button',
              {
                type: 'button',
                className: 'gi-btn',
                onClick: onCheck,
                disabled: checkBusy || state.status === 'loading',
                title: '到 GitHub 上逐项比对上游有没有新版本',
              },
              checkBusy ? '检查中…' : '检查更新',
            ),
            h(
              'button',
              { type: 'button', className: 'gi-btn', onClick: load, disabled: state.status === 'refreshing' },
              state.status === 'refreshing' ? '扫描中…' : '重新扫描',
            ),
          ),
        ),
        data
          ? h(
              'div',
              { className: 'gi-toolbar' },
              h(
                'div',
                { className: 'gi-search' },
                h('span', { className: 'gi-mag' }, '⌕'),
                h('input', {
                  ref: searchRef,
                  type: 'search',
                  value: query,
                  placeholder: '搜索名称、说明、仓库…（按 / 聚焦）',
                  onChange: (event) => setQuery(event.target.value),
                  'aria-label': '搜索已安装的扩展',
                }),
                query
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'gi-clear',
                        onClick: () => setQuery(''),
                        'aria-label': '清除搜索',
                      },
                      '×',
                    )
                  : null,
              ),
              h(
                'div',
                { className: 'gi-seg', role: 'group', 'aria-label': '类型筛选' },
                seg('all', '全部', data.counts.total),
                seg('skill', '技能', data.counts.skills),
                seg('cli', '命令行', data.counts.cli),
                seg('bundle', '插件包', data.counts.bundle),
              ),
              h(
                'select',
                {
                  className: 'gi-select',
                  value: status,
                  onChange: (event) => setStatus(event.target.value),
                  'aria-label': '状态筛选',
                },
                h('option', { value: 'all' }, '全部状态'),
                h('option', { value: 'on' }, '已启用 ' + data.counts.enabled),
                h('option', { value: 'off' }, '已停用 ' + data.counts.disabled),
                h('option', { value: 'unregistered' }, '没有来源 ' + data.counts.unknown),
                h('option', { value: 'favorite' }, '★ 收藏 ' + data.counts.favorite),
                data.counts.updatable ? h('option', { value: 'updatable' }, '可更新 ' + data.counts.updatable) : null,
              ),
              h(
                'select',
                {
                  className: 'gi-select',
                  value: sort,
                  onChange: (event) => setSort(event.target.value),
                  'aria-label': '排序',
                },
                h('option', { value: 'date' }, '按类型排序'),
                h('option', { value: 'name' }, '按名称排序'),
                h('option', { value: 'installed' }, '按安装日期排序'),
              ),
            )
          : null,
        data
          ? h(
              'div',
              { className: 'gi-chips' },
              h('span', { className: 'gi-chip' }, '共 ', h('b', null, data.counts.total), ' 项'),
              h('span', { className: 'gi-chip' }, '启用 ', h('b', null, data.counts.enabled)),
              h('span', { className: 'gi-chip' }, '停用 ', h('b', null, data.counts.disabled)),
              data.counts.updatable
                ? h('span', { className: 'gi-chip upd' }, '可更新 ', h('b', null, data.counts.updatable))
                : null,
              data.counts.unknown
                ? h(
                    'span',
                    { className: 'gi-chip warn' },
                    '来源未知 ',
                    h('b', null, data.counts.unknown),
                  )
                : null,
              filtering ? h('span', { className: 'gi-chip' }, '匹配 ', h('b', null, visible.length), ' 项') : null,
            )
          : null,
        data && data.counts.unknown && !filtering
          ? h(
              'div',
              { className: 'gi-banner' },
              h(
                'div',
                null,
                h('b', null, data.counts.unknown + ' 项没有来源记录。'),
                '常见公开包（nature-* 等）已经由随包的 catalog.json 认出来；剩下的多半是本地自写，或安装时没留下痕迹——',
                '打开详情页可以手动补一个仓库地址，写回 ',
                h('code', null, '~/.dsh/github-inventory.json'),
                '。',
              ),
            )
          : null,
        data && data.self && data.self.newer
          ? h(
              'div',
              { className: 'gi-banner self' },
              h(
                'div',
                null,
                h('b', null, '这个插件自身有新版本 ' + data.self.remote + '。'),
                ' 当前 ' + data.self.local + '；更新会先整目录备份，再用仓库 main 分支的文件覆盖，重启 DSH 后生效。',
              ),
              h(
                'button',
                { type: 'button', className: 'gi-btn', onClick: onSelfUpdate, disabled: selfBusy },
                selfBusy ? '更新中…' : '更新插件',
              ),
            )
          : null,
        state.error ? h('div', { className: 'gi-error' }, state.error) : null,
        notice
          ? h(
              'div',
              { className: 'gi-status', style: { textAlign: 'left', padding: '10px 14px', marginBottom: '12px' } },
              notice,
            )
          : null,
        state.status === 'loading'
          ? h('div', { className: 'gi-status' }, '正在扫描…')
          : items.length === 0
            ? h('div', { className: 'gi-empty' }, '还没有扫描到任何扩展。')
            : visible.length === 0
              ? h(
                  'div',
                  { className: 'gi-empty' },
                  '没有匹配的扩展。',
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'gi-btn',
                      style: { marginLeft: 8 },
                      onClick: () => {
                        setQuery('')
                        setKind('all')
                        setStatus('all')
                      },
                    },
                    '清除筛选',
                  ),
                )
              : h(
                  'div',
                  null,
                  h(Group, {
                    kind: 'skill',
                    items: grouped.skill,
                    busy,
                    onToggle,
                    onOpen: setSelected,
                    onStar,
                  }),
                  h(Group, {
                    kind: 'cli',
                    items: grouped.cli,
                    busy,
                    onToggle,
                    onOpen: setSelected,
                    onStar,
                  }),
                  h(Group, {
                    kind: 'bundle',
                    items: grouped.bundle,
                    busy,
                    onToggle,
                    onOpen: setSelected,
                    onStar,
                  }),
                ),
        h(
          'p',
          { className: 'gi-foot' },
          '来源按「本机登记表 > 目录内标记 > SKILL.md 字段 > .git remote > 随包 catalog.json > README 推断」的顺序解析；' +
            '标题与说明优先取登记表，其次 SKILL.md 的 name / description。' +
            (data && data.scannedAt ? ' 上次扫描 ' + new Date(data.scannedAt).toLocaleString('zh-CN') : ''),
        ),
        selected
          ? h(Detail, {
              item: (data && data.items.find((i) => i.key === selected.key)) || selected,
              onClose: () => setSelected(null),
              onStar,
              onToggle,
              onSaved: (patch) => {
                setSelected((current) => (current ? { ...current, ...patch } : current))
                load()
              },
              busy,
            })
          : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: 'github-inventory', order: 56, label: 'GitHub 下载' },
            Page,
          ),
        )
      },
    }
  },
})