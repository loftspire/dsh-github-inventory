# dsh-github-inventory

设置页里的「GitHub 下载」一页：把从 GitHub 装进这台机器的技能、命令行工具、插件包列成一张表，
每项写清「它能干什么」「来自哪个仓库」「装在哪」，技能还给一个开关。

## 它扫什么

| 来源 | 说明 |
| --- | --- |
| `~/.dsh/skills/*/SKILL.md` | 用户级技能，主来源 |
| `~/.agents/skills/*/SKILL.md` | 另一条用户级技能根 |
| `~/.dsh/skills-disabled/*/SKILL.md` | 本插件停用的技能（`enabled: false`） |
| `~/.dsh/github-inventory.json` | 人工登记的来源与说明（标题、GitHub 地址、版本、安装日期、CLI 路径） |
| `<profile>/package.json` → `dsh.profile.bundles` | 已加载的插件包；只展示登记表里标了 `kind: bundle` 的那些 |

技能的标题与说明优先取登记表，其次取 `SKILL.md` 的 `name` / `description`，再次取正文首段。
**没登记的技能照样会列出来**，只是没有 GitHub 链接——它们多半来自本机离线包，不是 GitHub。

## 开关语义

开关只对**技能**开放。实现是目录搬动：

- 关：`~/.dsh/skills/<name>` → `~/.dsh/skills-disabled/<name>`，原属根记进 `~/.dsh/github-inventory-state.json`
- 开：搬回原来的根

`skill-filesystem` 有 watcher，改完技能目录当前会话即时生效，不需要重启。
命令行工具与插件包是只读的——CLI 卸载要删文件，插件包要在插件页卸载，本页只负责告诉你它是什么、装在哪。

## 交互

- 鼠标移到一行：整行高亮，行尾浮现 `↗`（有仓库地址时才出现），点它直接用系统浏览器打开原页面。
- 点一行正文：弹出详情卡——说明全文、类型/版本/安装日期/所在位置、文件绝对路径（可一键复制）、底部按钮「打开下载页 / 打开 GitHub 页面」「打开仓库」「复制本地路径」。`Esc` 或点遮罩关闭。
- 行尾开关：只对技能生效，点了立即搬目录；命令行工具与插件包显示「只读 / 插件页管理」。

外链怎么来：`source` 是仓库地址；`downloadUrl` 可选，指具体下载页（release 页或仓库根）。
不写 `downloadUrl` 时由 host 按版本号推导：语义化版本 → `<repo>/releases/tag/v<version>`，否则 → `<repo>/releases`。
没登记 `source` 的条目（例如本机离线装的技能）不显示 `↗`，详情里标「本地安装，未登记来源仓库」。

## 接口

都是回环 + 同源才放行：

- `GET /api/github-inventory/list` → `{ items, counts, roots, scannedAt }`
- `POST /api/github-inventory/skill` body `{ key, enabled }` → `{ ok, key, enabled, location }`

`item` 字段：`id / kind(skill|cli|bundle) / key / title / summary / source / version / installedAt / location / root / enabled / toggleable / registered`。

## 登记新条目

编辑 `~/.dsh/github-inventory.json`，往 `items` 里加一条，`key` 与技能目录名（或插件包名）一致：

```json
{
  "key": "某个技能的目录名",
  "kind": "skill",
  "title": "显示用的名字",
  "summary": "它能干什么，一句话到三句话",
  "source": "https://github.com/owner/repo",
  "version": "1.2.3",
  "installedAt": "2026-11-15"
}
```

命令行工具用 `kind: "cli"` 并给 `cli` 绝对路径（存在与否决定显示为启用还是「未找到可执行文件」）；
插件包用 `kind: "bundle"`，`key` 就是 npm 包名。

## 边界

- 只覆盖**本机安装物**，不查询 GitHub 账号的下载历史——GitHub 本身也不提供（release 资产下载是匿名 CDN 请求，不进账号活动）。
- MCP server（如 Tavotto、Agentero 的 Python/CLI 引擎）不单独成行，它们的开关在 profile 的 `cordis.patch.yml`。
- 停用一个技能只影响 DSH 的技能目录，不删文件、不动磁盘上的其他副本。

## 0.2.0 · 参照插件市场补的交互

- **搜索**：匹配标题、key、说明、仓库、版本、所在根；按 `/` 聚焦，`×` 清除，只在已扫描结果里过滤。
- **筛选**：类型分段（全部 / 技能 / 命令行 / 插件包，带计数）；状态下拉（全部状态 / 已启用 / 已停用 / 没有来源 / ★ 收藏）。
- **排序**：按类型、按名称、按安装日期。
- **收藏**：行尾 ★ 与详情卡按钮，写 `~/.dsh/github-inventory-favorites.json`（`{ "keys": [...] }`），失败回滚。
- 行内显示技能目录条目数；未命中筛选时给空态与「清除筛选」。

## 0.3.0 · 来源不再只靠一张手工表

0.2.0 之前来源只认 `~/.dsh/github-inventory.json`：换一台机器、或者把插件发给别人，那文件不存在，全部条目都会变成「未登记来源」。这一版把来源做成**自证 + 分级**：

| 级别 | 依据 | 徽标 |
| --- | --- | --- |
| `registry` | `~/.dsh/github-inventory.json` 里写了 `source` | 不显示（视为已知） |
| `marker` | 目录内 `.dsh-source.json`（`{ source, downloadUrl }`） | 目录自证 |
| `header` | `SKILL.md` frontmatter 的 `source` / `repository` / `repo` / `homepage` | 目录自证 |
| `git` | 目录内 `.git/config` 的 `url =`（https 与 `git@github.com:` 都认） | 仓库副本 |
| `catalog` | 随包 `catalog.json`（31 条，含 24 个 nature-* → `Yuan1z0825/nature-skills`） | 随包目录 |
| `inferred` | `README.md` / `README_EN.md` 里第一个 GitHub 链接 | 推断 |
| `unknown` | 都没有 | 未知 |

配套改动：

- 带 `path` 的 catalog 条目，下载链接直指子目录页（如 `.../tree/main/skills/nature-writing`），而不是仓库根。
- 详情卡新增「补充来源」：`unknown` / `inferred` 时出现输入框，保存走 `POST /api/github-inventory/source`，写回登记表后就地更新并重新扫描。
- 文案从「本地安装，未登记来源仓库」改成「没有来源记录（可在下方补充）」；提示条与筛选器统一叫「来源未知」。
- `catalog.json` 是公开知识，随包分发；本机登记表只放个人增补。

接口：`POST /api/github-inventory/source`，body `{ key, source, downloadUrl? }`；`source` 必须以 `http(s)://` 开头（否则 400 `invalid source`，长度上限 500），key 校验同其余接口。回环 + 同源校验、非 POST 405 不变。

## 0.4.0 · 检查更新与插件自更新

页面顶部多了一个「检查更新」按钮，两件事一起做：

**① 逐项比对上游。** 先把每个条目的 `source` 归纳成 `owner/repo`，同一个仓库只查一次（nature-* 那 24 个技能共用一个仓库，不会打 24 次），然后：

- 有 release 的条目（Tavotto、Agentero 这类）：`GET /repos/{repo}/releases/latest`，把 `tag_name` 里的版本号和本地 `version` 按语义化版本比对，远端更大就是「有新版本 x.y.z」。
- 没有 release 的条目（技能、源码型插件）：`GET /repos/{repo}/commits?path=<子目录>&per_page=1`，拿到该目录最新一次提交的 sha。第一次检查只把 sha 记成**基线**（状态 `baseline`，卡片上写「已记录基线，下次检查开始比对」），之后 sha 变了才算「上游这个目录有了新提交」——这样不会因为「本来就没版本号」而误报。

状态一共五种：`newer` 有更新、`current` 与基线一致、`baseline` 刚记基线、`no-source` 没有上游地址、`error` 查不动（网络或限流，卡片上带原因）。结果写进 `~/.dsh/github-inventory-checks.json`，列表接口每次带上 `update` 字段，所以刷新页面不用重新查。

**② 插件自身更新。** 拿 `GET /repos/loftspire/dsh-github-inventory/contents/package.json` 和本地 `package.json` 比版本；远端更新时顶部出现绿色提示条，点「更新插件」= 先整目录备份到 `~/.dsh/backups/github-inventory-<时间戳>/`，再按仓库 main 的文件树逐个下载覆盖（跳过 `.git`、`node_modules`，并拒绝写到插件目录之外）。写完提示「重启 DSH 后生效」——宿主侧代码已经是旧代际，只有重启才会换新的 `apply`。

限流提醒：GitHub 未登录 API 是每小时 60 次，本机 29 项只归约到 6 个仓库、约 12 次请求，够用；条目多起来时可以在环境变量里放 `GITHUB_TOKEN`（只读即可），调用会自动带上。

接口：

- `POST /api/github-inventory/check` → `{ ok, checkedAt, repos, newer, self, items }`
- `POST /api/github-inventory/self-update` → `{ ok, files, backup, local, remote, restartRequired }`

两条都只收 POST（GET 返 405）、只收回环同源请求（否则 403）。
