# dsh-github-inventory

在 DeepSeek Harness 的设置页里加一页「GitHub 下载」，把本机从 GitHub 装进来的**技能、命令行工具、插件包**列成一张表：每个东西是干什么的、从哪个仓库来的、装在哪、现在开没开——技能可以一键开关，其余（CLI、插件）给操作指引，因为你也能自己改。

它解决的问题很具体：DSH 里装进来的东西是散的——技能在 `~/.dsh/skills`，CLI 在别处，插件包在 profile 的 `bundles` 里。装的时候知道，过两周就忘了哪个是哪个、还能不能删。这页把散落的装进来一次看全；更重要的是**来源信息随包走**，换台机器或发给别人时，不会满屏都是「未登记来源」。

![来源分级：已登记 / 随包目录 / 目录自证 / 推断 / 未知](icon.svg)

## 安装

DSH 桌面版或 Web 版都能装，装到哪个 profile 就写哪个：

```bash
# 从 GitHub 装（推荐）
dsh plugin --profile desktop add "git+https://github.com/loftspire/dsh-github-inventory.git"

# 或者本地目录
dsh plugin --profile desktop add "file:/绝对路径/dsh-github-inventory"
```

也可以用 Agent 装：把仓库目录告诉它，用 `plugin_manager` 的 `install_bundle` 指向这个目录。装完**重启一次 DSH**——宿主侧的路由要在新代际里才生效，页面刷新只换前端。

装好后打开「设置 → GitHub 下载」。

## 你能做什么

| 操作 | 说明 |
| --- | --- |
| 一行看全 | 名称、一句话说明、类型徽标（技能 / 命令行 / 插件包）、来源徽标、开关 |
| 搜索 | 名称、说明、仓库地址都搜；按 `/` 直接聚焦搜索框 |
| 筛选 | 类型分段控件（带计数）、状态（已启用 / 已停用 / 来源未知 / ★ 收藏） |
| 排序 | 按类型、按名称、按安装日期 |
| 收藏 | 行尾 ★，收藏存在本机，常用的一眼就能捞出来 |
| 开关技能 | 行内开关：目录在 `~/.dsh/skills` 与 `~/.dsh/skills-disabled` 之间搬，热加载立即生效 |
| 详情卡 | 点行打开：完整说明、类型、版本、安装日期、所在位置、文件数、来源，以及「打开仓库 / 打开下载页 / 复制本地路径」 |
| 检查更新 | 顶部「检查更新」：到 GitHub 逐项比对上游（有 release 比版本号，没有的比目录最新提交），有更新的行带绿色「可更新」徽标，也能筛出来 |
| 更新插件自身 | 本插件自己发了新版本时，顶部出现绿色提示条，点「更新插件」就备份旧版、按仓库 main 覆盖自身文件，重启生效 |

命令行工具和插件包是**只读展示**——它们的启用状态由 profile 的 `bundles` 和 PATH 决定，随手改会得出半截状态，所以只告诉你它是什么、装在哪，要动就给指引。

## 检查更新

顶部「检查更新」一次做两件事：比对**列表里每一项**的上游、以及**插件自身**有没有新版。

- 有 release 的条目：比 `releases/latest` 的 tag 与本地版本号。
- 没有 release 的条目（多数技能）：比该子目录最新一次 commit。第一次检查只记基线（`已记录基线，下次检查开始比对`），之后 commit 变了才算有更新——技能本来就没有版本号，用提交当水位最实在。
- 状态共五种：`有更新` / `已是最新` / `刚记基线` / `没有上游地址` / `检查失败（带原因）`，都存在 `~/.dsh/github-inventory-checks.json`，刷新页面不用重查。

未登录的 GitHub API 是每小时 60 次；29 个条目归约成 6 个仓库（24 个 nature-* 共用一个），约 12 次请求。条目多起来时给环境变量 `GITHUB_TOKEN` 放一个只读 token，调用会自动带上。

本插件自身发新版时，顶部会出现绿色提示条：点「更新插件」→ 整目录备份到 `~/.dsh/backups/`，再按仓库 main 的文件树覆盖，**重启 DSH 生效**（宿主侧代码要新代际才换得上）。

## 来源分级

「它从哪来」按下面顺序判定，越靠前越硬：

| 徽标 | 级别 | 依据 |
| --- | --- | --- |
| （无徽标） | 已登记 | `~/.dsh/github-inventory.json` 里写了 `source` |
| 随包目录 | catalog | 插件自带的 `catalog.json` 命中（见下） |
| 目录自证 | marker / header | 目录里的 `.dsh-source.json`，或 SKILL.md frontmatter 的 `source` / `repository` / `repo` / `homepage` |
| 仓库副本 | git | 目录里有 `.git/config` 且 remote 指向 GitHub |
| 推断 | inferred | 目录 README 里出现的第一个 GitHub 链接（能点，但标「推断」） |
| 未知 | unknown | 什么都没找到 |

「未知」和「推断」的条目在详情卡里带一个**补充来源**输入框：填上仓库地址保存，就写回 `~/.dsh/github-inventory.json`，下次换机器把这张表带走即可。

### catalog.json：让来源随包分发

`catalog.json` 是插件自带的公开目录，记录**公开包**的仓库归属，所以新机器上即使没有本机登记表，也能认出这些条目：

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

带 `path` 的条目，下载链接会直指 `<repo>/tree/main/<path>` 子目录，而不是仓库根。想把自己熟悉的公开包补进来，改这一个文件提 PR 就行。

## 数据文件

| 路径 | 作用 |
| --- | --- |
| `~/.dsh/github-inventory.json` | 来源登记表（可手填）：`{"items": {"<key>": {"source": "https://github.com/…", "downloadUrl": "…"}}}` |
| `~/.dsh/github-inventory-favorites.json` | 收藏：`{"keys": ["…"]}` |
| `~/.dsh/github-inventory-state.json` | 被停用技能的原始根目录，重新启用时放回去 |
| `~/.dsh/skills-disabled/` | 停用的技能目录 |

扫描范围：`~/.dsh/skills`、`~/.dsh/skills-disabled`、`~/.agents/skills`，加上 profile `package.json` 里 `dsh.profile.bundles` 登记的插件包。

## HTTP 接口

宿主侧注册三条本地路由（只接受回环地址、同源请求；跨站与非回环一律 403）：

| 方法 | 路径 | 请求体 | 作用 |
| --- | --- | --- | --- |
| GET | `/api/github-inventory/list` | — | 全部条目 + 计数 |
| POST | `/api/github-inventory/skill` | `{"key":"…","enabled":true}` | 开关技能 |
| POST | `/api/github-inventory/favorite` | `{"key":"…","favorite":true}` | 收藏 |
| POST | `/api/github-inventory/source` | `{"key":"…","source":"https://…"}` | 补充来源 |

`key` 只接受名字片段（不含 `/`、`\`，不以点开头），其余一律 400；`source` 必须是 `http(s)://` 开头、长度 ≤500。

## 开发

没有构建步骤，纯 ESM + 手写的 `__ModuleLoader__` bundle：

- `index.js` 宿主侧：扫描、来源判定、三条写入路由；`export const inject = ['webServer']`。
- `client.js` 客户端：设置页 `settings.section` 贡献，样式全用 `--dsw-alias-*` 主题 token，跟随明暗主题。
- `locale/{zh,en}.json`：设置页里的标题与说明；`docs/DETAIL.md`：「插件详情」页的正文。

改 `client.js` 刷新页面即生效（本地 bundle 是软链）；改 `index.js` 要重启 DSH。验证宿主逻辑可以绕开鉴权：用假 `ctx` 拿到 `ctx.webServer.register` 的 handler，直接喂 `fakeReq/fakeRes` 调。

## 限制

- 只认识「技能目录 + profile bundles」这两类落点，不扫任意安装的桌面应用。
- 开关只对技能生效；插件包与 CLI 的状态不由它决定。
- 来源判定不联网、不比哈希：`inferred` 是猜的，`unknown` 只代表「没找到记录」，不代表不是从 GitHub 来的。

## License

MIT