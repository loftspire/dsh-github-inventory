## 0.6.2

### 修复

- **没有 Release 的仓库永远显示「有新版本」**：以前只比 commit SHA，仓库里改个 README 也算更新。
  现在技能比 `SKILL.md` 的内容指纹、其它比仓库 `package.json` 的版本号，取不到才回落到 commit 比对。
- 内容比对走 `raw.githubusercontent.com`，不消耗 GitHub API 限流；而且它被提到 API 调用之前，
  所以**限流状态下仍能判定**（实测 remaining=0 时 29 条里 27 条照常给出结论）。
- 技能上游路径按「登记子目录 → 仓库根 `SKILL.md` → `skills/<key>/SKILL.md`」依次试，
  仓库根平铺的技能不必手工登记子目录。

### 新增

- 更新判定结果多一个 `mode` 字段（`content` / `version`），说明这次是按内容还是按版本判的。

## 0.6.1 — 检查结果缓存 30 分钟

### 新增

- **检查结果缓存**：30 分钟内重复请求直接复用上次结果，不再重复打 GitHub；点「检查更新」按钮发 `{ force: true }` 强制穿透。
- **条目指纹**：缓存跟着「这批条目」走（`key/version/source/deepLink` 的 sha256 前 16 位）。装了新技能、改了来源、升了本地版本，旧结论立即作废，不会把上一个状态当成当前状态。
- `list` 同样校验指纹：对不上就当作没查过，不再挂着过期的「可更新」标记。
- 响应新增 `cached` 与 `expiresAt` 字段。

### 修复

- 失败结果（限流/网络错误）只缓存 1 分钟，而不是跟着 30 分钟一起压着——错的结论不该拦着用户重试。

### 测试

`tests/cache.test.mjs`：复用命中、force 穿透、指纹变化失效、失败结果短缓存。

## 0.6.0 — 自更新原子化、限流可见、测试进仓库

### 修复

- **自更新不再是「改一半」**：先整棵下载到暂存目录并校验，通过才备份覆盖；覆盖出错用备份整目录还原。
- **不再留孤儿文件**：覆盖后删掉上游已不存在的文件，返回值里的 `removed` 会列出来。
- **限流不再被吞成「没有新版本」**：读 `x-ratelimit-*` 头，区分限流 / 超时 / 网络 / 404，面板顶部用琥珀色提示条说明，并显示恢复时间。
- header 缺失时不再误判成「剩 0 次」（此前 `Number(null) = 0` 会让任何缺头的响应都被当成限流）。

### 新增

- `tests/`：`npm test` 跑 list / check / guards 三组共 52 个断言，假 ctx + mock fetch，不联网、不碰真实目录。
- 列表 `counts.failed`：这次检查有多少项没查成。

## 0.5.1 — 一键重启

### 新增

- **重启 DSH**：设置页顶部新增按钮，二次确认后由宿主派一个 detached 助手进程；助手沿父进程链认出应用主进程，先请它自己退出（`taskkill` 不带 `/F`），退不掉再强制结束，最后自动重新打开。
- 插件自更新成功后，页面出现「立即重启」提示条，不必自己去关应用。
- 重启期间前端探活：页面短暂断开，宿主回来后自动刷新数据。

### 接口

- `POST /api/github-inventory/restart` → `{ ok, restarting, hostPid, helper, log }`；
  非桌面端返回 400 并说明原因，重复点击返回 `already: true`。

助手脚本写在临时目录、跑完自删；过程日志在 `%TEMP%\dsh-restart.log`。
## 0.4.0 — 检查更新 & 插件自更新

### 新增

- **检查更新**：一键比对列表中每个条目与上游是否有新版本。
  - 有 Release 的仓库比语义化版本号；无 Release 的仓库比指定子目录（`skills/<name>`）的最新提交。
  - 首次检查只记录基线，之后只有上游变化才标「可更新」。
  - 结果写入 `~/.dsh/github-inventory-checks.json`，列表每项带 `update` 字段。
- **更新插件自身**：比对本地与远端 `package.json` 版本，确认后覆盖本插件文件。
  - 覆盖前整目录备份到 `~/.dsh/backups/github-inventory-<时间戳>`。
  - 路径越界直接拒绝写入；需要重启 DSH 让新的宿主代码生效。

### 界面

- 顶部新增「检查更新」按钮，可更新数量显示在筛选项与徽标上。
- 每行可更新时显示版本徽标，详情卡新增「更新」一行。
- 远端有新版本时，页面顶部出现提示条与「更新插件」按钮。

### 接口

- `POST /api/github-inventory/check` → `{ok, checkedAt, repos, newer, self, items}`
- `POST /api/github-inventory/self-update` → `{ok, files, backup, local, remote, restartRequired}`

两条接口均要求回环请求且为 POST，否则分别返回 403 / 405。

### 安装

```bash
dsh plugin --profile desktop add https://github.com/loftspire/dsh-github-inventory
```

或将本仓库目录直接放进 profile：`plugin_manager install_bundle` + 目录绝对路径。