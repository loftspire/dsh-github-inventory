# dsh-github-inventory

设置页里的「GitHub 下载」一页：把从 GitHub 装进这台机器的技能、命令行工具、插件包列成一张表，
每项写清「它能干什么」「来自哪个仓库」「装在哪」，技能还给一个开关。

## 0.9.6 · 版本号跟着实际内容走

- 症状：更新完（或上游内容其实一直一致）后，列表里的版本号仍是安装那天填的旧值，例如 `tavotto-figure` 永远写 `v0.19.2`。
- 原因：`buildSkillItem` 的 `version` 只读登记表 `version` 字段，而更新流程只写文件与 `.dsh-source.json`，从不回写登记表。
- 修法：`updateItem` 在「写入成功」与「内容已一致」两条分支上都会算出上游实际版本——有 release tag 就是 `v<tag>`，只有分支就是 `HEAD@<短 sha>`——并回写登记表里**已存在**的条目（纯本地技能不凭空造条目）。返回值多了 `version` / `versionUpdated`。

## 0.9.5 · 检查与更新共用一套上游定位

- 症状：「可更新 0.21.2」的徽标常在，点更新却提示「内容和本地一致」——检查走的是 `contentCompare`（只试根目录 `SKILL.md` 与 `skills/<key>/SKILL.md`），更新走的是 `upstreamDir`（还会试 `codex-plugin/skills/<key>`、仓库树里任意 `*/skills/<key>`、frontmatter name、登记表 `dir`）。
- 两条路径候选不一致，Tavotto 这类把技能放在 `codex-plugin/skills/` 的仓库就会永远「有新版本」。
- 修法：`contentCompare` 的技能分支先走同样的候选清单（含 `codex-plugin/skills/<key>`），仍未命中则调用 `upstreamDir` 拿真实目录与 ref 再取 `SKILL.md`；两者都不成，才回落到 release 版本比对。

## 0.9.4 · 改动预览改成居中弹层

- 「更新前先看改动」原来是页内一条黄色横条，会挤在列表上方、看起来像盖住了内容；现在改成居中弹层：半透明遮罩 + 卡片（最大 560px、最高 82vh、内容可滚动），点遮罩或「取消」即关，不再占列表位置。
- 弹层里依次是：标题、改动统计、「上游说明」、「会改动的文件」、（可选）「上游 X 小时前刚发布」提示，底部「知道了 / 仍然更新 / 更新」与「取消」。

## 0.9.3 · 结论与动作对齐

- **「可以更新」和「已是最新」不再同时出现**：预览算出 `added + changed + removed === 0` 时，`updateItem` 会调 `markCurrent(key, '内容和本地一致')` 把检查结果里该条目改成 `current`，徽标与计数随下一次列表刷新消失；确认条那一栏改为「内容和本地一致」，按钮变成「知道了」，点了只关面板并刷新列表，不再发更新请求。
- **僵尸任务会自己降级**：`readTasks()` 把超过 30 分钟的 `running` 标成 `interrupted`（不再是「正在跑」）；`recordTask` 在同一条目成功后清掉它的 `running / interrupted` 旧记录。界面只在真有 `running` 时提示，并给「清除记录」（`POST /api/github-inventory/tasks`）。
- **先看改动再决定**：进页面自动检查 / 手动「检查更新」完成后，`previewFirst(data)` 自动为第一个可更新技能拉一次预览（`preview: true`，不写盘），把「会改哪些文件 + 上游说明 + 版本锚点」直接摊在页面上；同一 key+版本只自动弹一次，避免打扰。

## 0.9.2 · 版本锚点、24 小时提示、任务留痕与回滚

- **版本锚点**：`resolveUpstreamRef(repo)` 先问 `/releases/latest`。有 Release 就把 `ref` 钉在 tag 上（`raw.githubusercontent.com/<repo>/<tag>/…`、`git/trees/<tag>`），同一次更新永远取同一份内容；没有 Release 才回落到 `HEAD`，并在界面上标出来。基线 `.dsh-source.json` 里新增 `ref / refKind / refVersion`，下次能看出当初是从哪个 tag 装的。
- **24 小时提示（只提示不阻断）**：`freshOf(publishedAt)` 算出距发布的小时数，`< 24` 时随预览一起返回 `info.fresh`；确认条多一行「上游 v0.21.2 是 3.4 小时前刚发布的——现在装还是再等等，由你决定」。装不装仍由使用者点按钮决定，没有发布年龄门挡路。
- **任务留痕**：`~/.dsh/github-inventory-tasks.json` 记每次更新的开始 / 成功 / 失败（`status: running | done | failed`，上限 40 条），列表响应带最近 20 条。宿主中途被杀时那条 `running` 会留在文件里，下次打开页面顶部出现「上次有更新没跑完」的提示。
- **一键回滚**：`POST /api/github-inventory/rollback {key}` —— 取 `~/.dsh/backups/skills/<key>-<时间戳>` 里最新的一份，先把当前目录挪到 `backups/skills-rollback/`，再整目录换回去；失败时把挪走的原样放回。返回 `{restored, parked, backups}`。详情卡里技能条目多了「回滚到上次备份」按钮。
- 新增接口：`POST /api/github-inventory/rollback`。`__internals` 增加 `rollbackItem / listSkillBackups / readTasks / resolveUpstreamRef / freshOf` 便于测试。

## 0.9.1 · 详情卡里有「最近」了

每次真正写入更新，host 往 `~/.dsh/github-inventory-history.json` 追加一条，最多留 200 条；列表响应带 `history`（每个条目最近 5 条），详情卡底部显示成「8月3日 18:20 · 写入 9 个文件，删除 0 个」。

- `POST /api/github-inventory/history`：`{keys:[...]}` 取子集，`{action:'clear'}` 清空；只接受回环 + POST。
- 记录失败不影响更新本身。

## 0.9.0 · 更新前后盯住 profile 清单

- `snapshotProfile()`：更新前把 profile 的 `package.json` 里 `bundles` 与 `dependencies` 存进 `~/.dsh/github-inventory-profile.json`。
- `profileDrift()`：与快照比对，得出少掉的 bundle、少掉的依赖，以及「清单里有但磁盘上没有」的包，附在列表响应 `profile` 字段。
- `POST /api/github-inventory/profile`：`{action:'drift'|'snapshot'|'repair'}`；`repair` 先备份 `package.json`，再把缺失的 bundle 行写回（临时文件 + rename）。
- profile 目录取 `DSH_PROFILE_DIR`，否则 `~/.dsh/profiles/<DSH_PROFILE|desktop>`。

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
- `POST /api/github-inventory/restart` → `{ ok, restarting, hostPid, helper, log }`

两条都只收 POST（GET 返 405）、只收回环同源请求（否则 403）。

## 0.5.1 · 一键重启

宿主侧没有官方重启接口：Electron 壳的 `app.relaunch()` 只出现在开发菜单项和崩溃恢复对话框里，preload 也没向渲染层暴露重启通道，插件侧更拿不到 Host→shell 的 IPC（`isDesktopHostEvent` 只认 9 种消息，没有 restart）。所以自己拼一条：

`POST /api/github-inventory/restart` → 在 `os.tmpdir()` 写一个 `.cjs` 助手，用安装目录的 exe + `ELECTRON_RUN_AS_NODE=1` detached 起它，然后立刻回 HTTP（助手要先杀掉宿主，所以必须活在宿主之外）。

助手环境变量：`GI_HOST_PID`（宿主自己）、`GI_EXE`（安装目录的 exe）、`GI_LOG`。宿主不知道自己上面还隔了几层，所以让助手自己往上走：

1. 先等 800ms 让 HTTP 响应发出去；一条 `Get-CimInstance Win32_Process | ConvertTo-Json` 抓全表，从 `GI_HOST_PID` 沿 `ParentProcessId` 往上走（最多 12 层），取第一个「镜像路径 = `GI_EXE`、命令行里没有 `--type=`、也没有 `.asar`」的祖先进程当应用主进程；找不到就放弃（防止杀错进程）。
2. `taskkill /PID <app>`（不带 `/F`，等于发 WM_CLOSE 请应用自己关窗），每 250ms 探活，最多 8 秒。
3. 还在就 `taskkill /F /PID <app>`；随后把链上还在的 DSH 进程（宿主自己等）逐个 `/F`（不带 `/T`，否则会连带杀掉助手自己）。
4. `spawn(exe, [], { detached: true })` 重新拉起，`unref()` 之后自删脚本。

前端点按钮后轮询 `list` 探活：先看到断开、再看到恢复，就提示「已重启完成」并刷新页面。日志在 `%TEMP%\dsh-restart.log`。
## 0.5.0 · 同一来源的打包成二级目录

一级仍是类型（技能 / 命令行 / 插件包）。一级之下新增「二级目录」：同一上游仓库装进来的东西收成一个可折叠的分组行，点开才展开成员行。

归类规则（`index.js` 的 `collectionOf`）：

1. 同一仓库 ≥2 项 → 按仓库归组（`repo:owner/name`）；
2. 否则同一前缀 ≥2 项、且类型相同 → 按前缀归组（`prefix:xxx`）；
3. 都不满足 → 不归组，直接平铺。

本机当前：23 个 `nature-*` 技能都来自 `Yuan1z0825/nature-skills`，因此合成「Nature 学术套件 · 23 项」一行，不再占 23 行。

分组行显示：折叠箭头、组名、项数、组内「可更新 N」徽标。展开状态存在浏览器 `localStorage` 的 `gi-open-cols`，刷新后保持。

搜索时全部自动展开（避免搜到的条目藏在折叠里）。

兜底：若宿主的 `list` 响应里没有 `collection` 字段（host 还是旧代际，需要重启 DSH 才会加载新代码），前端按同一套规则自己算一遍，所以换新版 `client.js` 后只刷新页面即可看到分组，不必等重启。


## 0.6.0 · 自更新不再「改一半」，失败原因不再被吞

覆盖式更新此前的三个缺口，这一版都补上。

### 原子化

先把远端整棵树下载到 `~/.dsh/tmp/github-inventory-incoming-<时间戳>`，在暂存目录上校验。
校验不过就整块丢弃，本地文件一个字节都不动 —— 不再出现「下了一半、覆盖了一半」的中间态。

### 校验

`package.json`、`index.js`、`client.js`、`cordis.patch.yml` 必须齐全；所有 `.json` 必须能解析；JS 文件不能为空。
校验通过才备份、才覆盖；覆盖阶段任何一步出错，立刻用备份整目录还原并抛「更新失败，已用备份还原」。

### 删残留

覆盖完成后按远端文件清单删掉本地多出来的文件（返回值里的 `removed` 列出来），不再留孤儿模块。

### 限流与失败不再被吞成「没有新版本」

`githubApi` 现在读 `x-ratelimit-remaining`、`x-ratelimit-reset`、`x-ratelimit-limit` 三个头，
header 缺失时不再误判为「剩 0」；返回值带 `reason`，区分 `rate-limit` / `timeout` / `network` / `http-<code>` / `not-found`。

检查结果多出 `errors`、`errorSample`、`rateLimit`；面板顶部出现琥珀色提示条：

- 被限流 → 「上次检查被 GitHub 限流了。HH:MM UTC 后恢复」
- 有失败项 → 「上次检查有 N 项没查成。」+ 第一条失败原因
- 两种都带「重新检查」按钮

列表的 `counts` 也多一项 `failed`。

### 测试进仓库

`npm test` 跑 `tests/run.mjs`，三组共 52 个断言（list 17 / check 22 / guards 13），
用假 ctx 注册路由 + mock fetch，跑在 `GI_TEST_BASE` 指定的临时根上，不碰真实技能目录、不联网。


## 0.6.1 · 检查结果缓存 30 分钟

以前每个页面刷新都想给 GitHub 打一遍请求：29 个条目按仓库归并后是 6 个，看着不多，但来回切设置页就会把 60 次/小时的匿名额度耗掉，界面上还看不出来。

### 做法

- 检查结果写进 `~/.dsh/github-inventory-checks.json` 时多存两个字段：`fingerprint` 与 `expiresAt`（30 分钟后）。
- 不带 `force` 的请求命中未过期缓存，直接返回上次结果（响应里 `cached: true`），一个网络请求都不发。
- 点「检查更新」按钮时前端发 `{ force: true }`，强制重查。
- 缓存键不是时间，而是**条目指纹**：每个条目的 `key / version / source / deepLink` 拼起来取 sha256 前 16 位。装了个新技能、改了来源、升了本地版本，指纹就变，旧结论立刻作废，不会拿旧结果冒充当前状态。
- `list` 也按指纹校验：指纹对不上就当作「还没查过」，列表不再挂 `update` 字段。

### 失败结果只缓存 1 分钟

限流或网络错误写进缓存时，`expiresAt` 只给 60 秒：错的结论不值得压半小时，用户点「重新检查」通常就在一分钟内。

### 接口

- `POST /api/github-inventory/check`，body 可选 `{ "force": true }`
- 响应新增 `cached`（这次是不是读缓存）、`expiresAt`（缓存到期时间戳）

### 测试

新增 `tests/cache.test.mjs`：复用命中、force 穿透、指纹变化失效、失败结果短缓存。

## 0.6.2 · 没有 Release 的仓库改用内容比对

`api.github.com/repos/{repo}/releases/latest` 只对有发版的仓库有用。没有 Release 的仓库此前只能看
`/commits?path=…` 的 SHA 变没变，而仓库里任何一个无关提交（改 README、发别的版本的 tag）都会让
HEAD 变，导致这类条目永远显示「有新版本」。

现在改为直接比对上游那个文件的内容：

- **技能**：取 `raw.githubusercontent.com/<repo>/HEAD/<deepLink 子目录>/SKILL.md` 的内容 SHA-256，
  与上次记录的基线比；内容变了才算更新。技能目录里没有 deepLink 时自动回落到原来的 commit 基线。
- **其它（插件包、CLI 登记项）**：取仓库根 `package.json`，用 `compareSemver` 跟基线里的版本比。
- 首次见到某条目（或来源仓库换了）时只记基线，状态是 `baseline`，不会因为「第一次查到」就报更新。
- 取不到（404、超时、不是 JSON）一律返回 `null` 并回落到 commit 比对，所以旧行为不会被破坏。

好处：SKILL.md 的内容指纹不随无关提交变化，也不占用 GitHub API 的 60 次/小时限流——
`raw.githubusercontent.com` 是 CDN，不计入 API 配额。

### 内容比对优先，限流也挡不住

比对顺序是「先内容、后 API」：进循环第一件事就是取 `raw.githubusercontent.com` 的上游文件，
取到了就直接下结论，**完全不碰 `api.github.com`**。所以即使未登录的 60 次/小时已经用光，
29 个条目里也只剩真正取不到内容的少数几条会显示限流（实测：限流状态下 27 条仍照常判定）。

技能的上游路径按顺序试：登记的子目录 → 仓库根 `SKILL.md` → `skills/<key>/SKILL.md`。
这样「仓库根平铺的技能」（如 lieflat-less-ai-tone）和「skills/<name>/ 结构」（如 nature-*、
本插件自己的 agent-desktop 技能）都能比到，不需要每条都手工登记子目录。

## 0.6.3 · 顶部统计胶囊可点筛选

顶部那排统计胶囊（共 N 项 / 启用 / 停用 / 可更新 / 来源未知）从纯展示改成了按钮：

- 点一下 = 按这一类筛选，等价于在下拉里选对应状态；再点一下取消，回到「全部状态」。
- 选中态用品牌色实心底，`aria-pressed` 与 `title` 同时翻转（「只看这一类」/「再点一次显示全部」）。
- 和状态下拉共用同一个 `status` 状态值，所以点胶囊下拉会跟着变、点下拉胶囊也会跟着亮。
- 「匹配 N 项」仍是不可点的普通 span——它是筛选结果，不是筛选条件。

## 0.6.4 · 详情卡里的「能力扫描」

用户最初的需求是「看看每个东西能干什么」，0.6.4 补上了一份静态扫描：

- `scanCapabilities(dir)` 递归读目录里的文本文件（`.md/.js/.py/.sh/.ps1/.cmd/.json/.yml/.txt/.toml` 等），跳过 `.git`、`node_modules`、点开头的目录，单文件上限 256 KiB、上限 400 个文件。
- 分类收口四个清单：`net`（出现过的域名）、`exec`（`child_process`/`subprocess`/`powershell`/`npm install` 之类）、`fs`（`writeFile`/`rm -rf` 之类）、`secrets`（`*_TOKEN`/`*_API_KEY` 之类环境变量名），外加 `runtime`（目录里出现的执行环境）。
- 详情卡新增「能力扫描」块：一行一句「扫了 N 个文本文件」，下面按类列小标签；一条都没扫到时明确写「没扫到不等于安全」。
- 列表接口每项多一个 `capabilities` 字段；30 个条目的列表实测约 230 ms，可接受。

## 0.6.5 · 重启不再靠环境变量，顺便改名

以前「重启 DSH」只认两个环境变量（`DSH_INSTALL_DIR`、`DSH_NODE_EXECUTABLE`），
插件宿主拿到的环境可能被裁剪，于是按钮会莫名报「这个 DSH 不是桌面端」。
现在按顺序找 exe：

1. `DSH_NODE_EXECUTABLE`
2. `process.execPath`（Electron 宿主里它就是应用本体）
3. 从 `DSH_INSTALL_DIR` 里切掉 `resources/app.asar` 再拼 `DeepSeek Harness.exe`
4. 都落空时枚举进程：
   `Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'"` 取 `ExecutablePath`

拿到 exe 后由一次性 helper 干活：沿父进程链找到真正的应用进程 → `taskkill` 优雅关闭、
超时再 `/F` → 等残留退出 → 用同一个 exe 重新拉起 → 删掉自己。
四条路都找不到时，错误文案改成让人「手动退出重开」，不再谎称「不是桌面端」。

显示名同时从「GitHub 下载」改为 **本地扩展清单**（`locale/*.json` 的 `meta.title`、
设置页入口、页面标题一起改），简介写明它做什么，英文侧是 `Local extensions`。

## 0.7.0 · 进页面就能看见谁有新版本，点一下就更新

0.6.x 只能告诉你「有更新」，真正覆盖文件要自己动手。0.7.0 把它做成了按钮，并且不再需要每次进来手动点「检查更新」。

### 打开就查

`Page` 挂载后自动 `POST /api/github-inventory/check`（body 为 `{}`，不带 force）。宿主侧有 30 分钟指纹缓存，命中时不发一个网络请求，所以重复进页面是免费的；只有缓存过期或清单变了才真去拉。查完自动 `load()`，行内绿色「可更新 x.y.z」徽标直接出现。

### 单条更新怎么做的

`POST /api/github-inventory/update-item`（body `{ key, force }`）：

1. `repoTree(repo)` 取上游文件清单（`git/trees/HEAD?recursive=1`，成功结果缓存 10 分钟）；
2. `upstreamDir(item)` 定位子目录：先看 `deepLink` 里的 `/tree/<branch>/<path>`，再看 `skills/<key>`，都没有就认为仓库根就是技能本身；
3. 逐个文件走 `raw.githubusercontent.com/<repo>/HEAD/<path>` 下载（CDN，不占 API 配额），算 sha256 与本地比对，得出 added / changed / removed / unchanged；
4. 有本地改动（manifest 里记录的 sha 与当前文件不符）或没有安装基线时，先返回 `needConfirm: true` 和计划摘要，界面弹黄条让你确认；确认后带 `force: true` 再调一次；
5. `applySkillUpdate` 先把整个技能目录备份到 `~/.dsh/backups/skills/<key>-<时间戳>`，再写新增与变更、删上游已删的、补写 `.dsh-source.json`；中途出错则删目录并从备份还原。

`.dsh-source.json` 是这次新增的安装基线：`{ repo, dir, at, files: { 相对路径: sha256 } }`。没有它就只能靠「文件序号」猜，判断不出哪些是你改过的。

### 边界

- 只有技能能一键更新。插件包归 profile 的 pnpm 管，CLI 归各自 release 管，插件不去碰。
- 停用的技能（在 `~/.dsh/skills-disabled`）不允许更新，先启用。
- 上游的仓库元数据（`.gitignore`、`.github/`、`node_modules/`、点开头的文件）一律跳过：它们不是技能内容，也不该被删。
- 抓不到的文件（网络抖动）不算失败：重试两次仍失败就跳过并计入 `plan.unreadable`，不会让整次更新回滚。

## 0.6.6 · 修「只杀掉、不重开」

重启助手自己是被 `ELECTRON_RUN_AS_NODE=1` 拉起来的（借宿主 exe 当 node 用），
于是它 `spawn(exe)` 重新拉起应用时，这个变量被一起继承下去——
新进程也就当 node 跑，没有脚本、没有窗口，立刻退出。日志里只能看到
`relaunched pid=...`，看上去「启动成功了」，实际什么都没起来。

现在的做法：

- 拉起应用前先拷一份环境，删掉 `ELECTRON_RUN_AS_NODE` 和 `GI_*` 变量，再 `spawn(exe, [], { env, cwd: 应用目录 })`；
- 启动后盯 2.5 秒，进程提前退出就把退出码写进 `%TEMP%\dsh-restart.log`；
- 万一还是不行，退一步用 `cmd /c start "" <exe>`（同样带干净环境）再拉一次。

判断是否修好：点一次「重启 DSH」，看 `%TEMP%\dsh-restart.log` 末几行——
成功只会有 `relaunched pid=`，不该出现 `relaunch exited early`。

## 0.7.1 · 更新前先看说明

点「更新」不再直接写盘，改成两段式：

1. 第一段 `POST /api/github-inventory/update-item`（`preview: true`）——只算计划、不写文件，同时抓上游的更新说明与最近一次提交。
2. 面板显示「改 N 个 · 新增 N 个 · 删 N 个」、上游 `CHANGELOG.md` 之类的第一个小节、以及最近提交的 sha 与标题。
3. 用户点「更新」才真正执行（`force: true`）。

说明从哪来：按 `CHANGELOG.md`、`CHANGELOG.en.md`、`CHANGELOG`、`RELEASE_NOTES.md`、`NEWS.md`、`HISTORY.md` 的顺序，取仓库里第一个存在的文件，截前 1600 字。上游没有这些文件时，退回到最近一次提交的标题（`GET /repos/{repo}/commits?path=<dir>&per_page=1`）。两者都拿不到，面板会明确写「上游没有 CHANGELOG 之类的更新说明」，不会留空。

## 0.8.1 · 找得到上游目录，也读得到 token

- `readToken()` 多了一个来源：`~/.dsh/secrets/*.token`（取第一个非 `#` 开头、非空的行）。这样把 PAT 放在仓库外也能用，不必写进环境变量。
- `buildSkillItem` 输出 `dirHint`（登记表 `dir` 或随包目录 `path`），`upstreamDir` 把它排进候选首位。
- `upstreamDir` 新增「按 SKILL.md frontmatter 的 `name` 猜目录」兜底：遍历仓库树里所有 `SKILL.md`（最多 12 个），挑 `name === key`、`name` 以 `key-` 开头、`key` 以 `name-` 开头或 `name` 含 `key` 的那个。Tavotto 那种把技能塞在 `codex-plugin/skills/` 下面的仓库因此能被找到。
- 找不到上游目录时，不再退化成「整个仓库当技能」去逐个下载；只有仓库根目录本身有 `SKILL.md` 且文件数 ≤ 400 才这么干，否则直接报「上游没找到 <key> 这个技能目录」。

## 0.8.2 · 本地自写的技能，别跟上游比

有些技能不是从某个仓库装来的——比如 `rea`，仓库里是工具本体，本地的技能正文是手写的。这类条目以前会被判「上游没找到」或者被上游内容覆盖。

- 登记表或随包目录里给条目加 `"noUpdate": true`，列表项就会带 `noUpdate` 标记。
- 检查更新时这类条目直接记为 `state: "local"`、说明「本地自写，不跟上游比对」，不发任何请求。
- 行内徽标显示灰色的「本地自写」，不出现「更新」按钮。

## 0.8.0 · 一次更新好几个，出错也不再白屏

- **全部更新**：工具栏新增按钮（带可更新数量），把当前所有「有新版本」的技能排进队列，一个接一个跑。每项先做一次预览（只读，不写盘），本地有改动或缺基线的项直接跳过并在队列里标「需要你单独确认」，其余自动写入。
- **任务面板**：更新期间页面底部浮出任务条，显示「正在更新 3/5」「更新 task-queue / 正在写入文件」，并写明「可离开本页面，进度会继续；回到这一页能看到结果」。可清空已完成、可收起。
- **渲染兜底**：整个设置页包在 `ErrorBoundary` 里。任何渲染期异常都会显示错误卡片（标题、错误信息、刷新页面按钮），不再是一整片空白。
- 修复：`updateAll` 在 `const items` 声明之前引用它，触发 `Cannot access 'items' before initialization`（TDZ）导致整页白屏，改为从 `state.data.items` 取。
