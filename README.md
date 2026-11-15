# dsh-github-inventory · 本地扩展清单

给 DeepSeek Harness 设置页加一页「**本地扩展清单**」：把本机从 GitHub 装进来的**技能、命令行工具、插件包**列成一张表——每个东西能干什么、从哪个仓库来、装在哪、开没开、有没有新版本，不用的技能当场关掉。

当前版本 **0.6.6**。

它解决的是一个很具体的问题：DSH 里装进来的东西是散的——技能在 `~/.dsh/skills`，CLI 在别处，插件包在 profile 的 `bundles` 里。装的那天你记得，过两周就忘了哪个是哪个、能不能删、还想不想要。这页把它们收在一处；更要紧的是**来源信息跟着包走**，换台机器或发给别人时，不会满屏都是「未登记来源」。

<img src="icon.svg" alt="icon" width="88" height="88">

## 安装

```bash
# 从 GitHub 装（推荐，装到哪个 profile 就写哪个）
dsh plugin --profile desktop add "git+https://github.com/loftspire/dsh-github-inventory.git"

# 或者本地目录
dsh plugin --profile desktop add "file:/绝对路径/dsh-github-inventory"
```

也可以用 Agent 装：让 `plugin_manager` 的 `install_bundle` 指向这个目录。装完**重启一次 DSH**（宿主路由要新代际才生效，刷新页面只换前端），然后打开「设置 → 本地扩展清单」。

## 界面里能做什么

| 操作 | 说明 |
| --- | --- |
| 一眼看全 | 名称、一句话说明、类型徽标（技能 / 命令行 / 插件包）、来源徽标、开关状态 |
| 二级目录 | 同一仓库来的东西自动收进一个可折叠分组（例如 24 个 `nature-*` 收成「Nature 学术套件」），展开状态记在本机 |
| 统计胶囊 | 顶部「共 / 启用 / 停用 / 可更新 / 来源未知」都能点：点一下只看这一类，再点一次取消 |
| 搜索 | 名称、说明、仓库地址都搜；按 `/` 聚焦搜索框 |
| 筛选排序 | 类型分段控件带计数；状态含「已启用 / 已停用 / 可更新 / 来源未知 / ★ 收藏」；可按类型、名称、安装日期排序 |
| 收藏 | 行尾 ★，存在本机，常用的随手能捞出来 |
| 开关技能 | 行内开关：目录在 `~/.dsh/skills` 与 `~/.dsh/skills-disabled` 之间搬，热加载立即生效 |
| 详情卡 | 点行打开：完整说明、类型、版本、安装日期、所在位置、文件数、来源，以及「打开仓库 / 打开下载页 / 复制本地路径」；未知来源还能就地补录 |
| 能力扫描 | 详情卡里列出它**实际会做什么**：读写的文件与环境变量、访问的网络域名、执行的命令、出现的密钥样式、需要哪个运行时。只做静态扫描，**扫不到不等于安全** |
| 检查更新 | 顶部「检查更新」逐项比对上游，有更新的行带绿色「可更新」徽标，也能筛出来 |
| 更新插件自身 | 本插件发了新版时顶部出现绿色提示条，点「更新插件」→ 备份旧版 → 按仓库 main 覆盖自身 → 重启生效 |
| 重启 DSH | 顶部「重启 DSH」：二次确认后请应用自己退出，退不掉再强杀，然后自动重新打开 |

命令行工具与插件包是**只读展示**：它们的启用状态由 profile 的 `bundles` 和 PATH 决定，随手改只会得到半截状态，所以这里只说清它是什么、装在哪，要动就给指引。

## 来源分级

「它从哪来」按下面的顺序判定，越靠前越硬：

| 徽标 | 级别 | 依据 |
| --- | --- | --- |
| （无徽标） | 已登记 | `~/.dsh/github-inventory.json` 里写了 `source` |
| 随包目录 | catalog | 插件自带的 `catalog.json` 命中 |
| 目录自证 | marker / header | 目录里的 `.dsh-source.json`，或 SKILL.md frontmatter 的 `source` / `repository` / `repo` / `homepage` |
| 仓库副本 | git | 目录里有 `.git/config` 且 remote 指向 GitHub |
| 推断 | inferred | 目录 README 里第一个 GitHub 链接（能点，但标「推断」） |
| 未知 | unknown | 什么都没找到 |

「未知」与「推断」的条目在详情卡里带**补充来源**输入框：填仓库地址保存，写回 `~/.dsh/github-inventory.json`，换机器时把这张表带走即可。

### catalog.json：让来源随包分发

`catalog.json` 是插件自带的公开目录，记录公开包的仓库归属——新机器上没有本机登记表，也能认出它们：

```json
{
  "version": 1,
  "items": {
    "nature-writing": {
      "source": "https://github.com/Yuan1z0825/nature-skills",
      "kind": "skill",
      "path": "skills/nature-writing"
    }
  }
}
```

带 `path` 的条目，下载链接直指 `<repo>/tree/main/<path>` 子目录而不是仓库根。想补自己熟悉的公开包，改这一个文件提 PR 就行。

## 检查更新怎么判

一次检查做两件事：比对列表里每一项的上游、以及插件自身有没有新版。

判定顺序（0.6.2 起）：

1. **先比内容，不碰 API**：技能取它所在子目录的 `SKILL.md`，其它取仓库根 `package.json`，走 `raw.githubusercontent.com` 的 `HEAD` 分支——CDN 请求，**不占 GitHub API 的 60 次/小时配额**。
2. 技能比 `SKILL.md` 的 sha256：第一次只记基线，内容变了才算有更新（技能本来没有版本号，拿内容当水位最实在）。
3. 其它比 `package.json` 的 `version`。
4. 抓不到内容时才回落到 API：有 release 比 tag 版本号，没有就比该路径最新一次 commit。

结果落在 `~/.dsh/github-inventory-checks.json`，缓存 **30 分钟**；点「检查更新」按钮会强制穿透缓存。缓存键是**条目指纹**（key + 版本 + 来源 + 子目录），装了什么变了旧结论自动作废。失败或限流只缓存 60 秒，界面顶部会给黄条说明原因与限流恢复时间，不会把「查不到」伪装成「已是最新」。

想让 API 配额更宽裕，给环境变量 `GITHUB_TOKEN` 放一个只读 token（公开仓库其实用不上）。

## 自更新与重启

**自更新**：点「更新插件」→ 先把整棵目录备份到 `~/.dsh/backups/github-inventory-<时间戳>/` → 按仓库 main 的文件树下载到临时目录 → 校验（必需文件在不在、JSON 是否合法）→ 覆盖并删除上游已不存在的文件 → 失败自动回滚。**重启 DSH 才生效**。

**重启**：写一个一次性助手，沿父进程链找到真正的应用进程，`taskkill` 请它自己退，退不掉再 `/F`，等残留退出后用同一个 exe 重新拉起。可执行文件按四条路径找：`DSH_NODE_EXECUTABLE` → `process.execPath` → 从 `DSH_INSTALL_DIR` 推断 → 枚举 `DeepSeek Harness.exe` 的进程路径。

> 0.6.6 修过一个坑：助手自己是借宿主 exe 以 `ELECTRON_RUN_AS_NODE=1` 运行的，拉起应用时这个变量被继承下去，新进程就「当 node 跑完即退」——现象是只杀不重开。现在拉起前会清掉它，并盯 2.5 秒把提前退出的退出码写进 `%TEMP%\dsh-restart.log`。

## 数据文件

| 路径 | 作用 |
| --- | --- |
| `~/.dsh/github-inventory.json` | 来源登记表（可手填）：`{"items": {"<key>": {"source": "https://github.com/…", "downloadUrl": "…"}}}` |
| `~/.dsh/github-inventory-checks.json` | 检查结果与基线（含指纹与过期时间） |
| `~/.dsh/github-inventory-favorites.json` | 收藏：`{"keys": ["…"]}` |
| `~/.dsh/github-inventory-state.json` | 被停用技能的原始根目录，重新启用时放回去 |
| `~/.dsh/skills-disabled/` | 停用的技能目录 |
| `~/.dsh/backups/` | 自更新前的整目录备份 |

扫描范围：`~/.dsh/skills`、`~/.dsh/skills-disabled`、`~/.agents/skills`，加上 profile `package.json` 里 `dsh.profile.bundles` 登记的插件包。

## HTTP 接口

宿主侧注册七条本地路由，**只接受回环地址 + 同源请求**（跨站、非回环一律 403；方法不符 405）：

| 方法 | 路径 | 请求体 | 作用 |
| --- | --- | --- | --- |
| GET | `/api/github-inventory/list` | — | 全部条目 + 计数 + 检查状态 + 自身版本 |
| POST | `/api/github-inventory/skill` | `{"key":"…","enabled":true}` | 开关技能 |
| POST | `/api/github-inventory/favorite` | `{"key":"…","favorite":true}` | 收藏 |
| POST | `/api/github-inventory/source` | `{"key":"…","source":"https://…"}` | 补充来源 |
| POST | `/api/github-inventory/check` | `{"force":true}` | 检查更新（`force` 穿透缓存） |
| POST | `/api/github-inventory/self-update` | — | 下载并覆盖自身（先备份，失败回滚） |
| POST | `/api/github-inventory/restart` | — | 重启宿主应用 |

`key` 只接受名字片段（不含 `/`、`\`，不以点开头），否则 400；`source` 必须 `http(s)://` 开头且长度 ≤500。

## 开发

没有构建步骤，纯 ESM + 手写 `__ModuleLoader__` bundle：

- `index.js` 宿主侧：扫描、来源判定、能力扫描、检查更新、自更新、重启；`export const inject = ['webServer']`，测试可直接用 `__internals`。
- `client.js` 客户端：设置页 `settings.section` 贡献；样式全用 `--dsw-alias-*` 主题 token，跟随明暗主题。
- `locale/{zh,en}.json` 设置页标题与简介；`docs/DETAIL.md` 是「插件详情」页的正文；`catalog.json` 是随包分发的来源目录。

改 `client.js` 刷新页面即生效（本地 bundle 是软链）；改 `index.js` 要重启 DSH。

## 测试

```bash
npm test
```

五组断言（list / check / cache / raw / guards）跑在临时目录里：假 `ctx` 注册路由、mock `fetch`，**不联网、不碰真实技能目录**。当前 90 条全绿。

## 限制

- 只认识「技能目录 + profile bundles」两类落点，不扫任意安装的桌面应用。
- 开关只对技能生效；插件包与 CLI 的状态不由它决定。
- 来源判定不联网、不比哈希：`inferred` 是猜的，`unknown` 只代表「没找到记录」，不代表不是从 GitHub 来的。
- 能力扫描是静态文本匹配，会漏（动态拼接的地址、加密载荷都扫不到），**扫不到不等于安全**。

## License

MIT