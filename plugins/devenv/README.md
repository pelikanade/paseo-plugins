# Paseo devenv

为 Paseo 0.10.2 的代理提供 devenv 项目环境、MCP、随包技能、操作说明与状态界面。插件使用 devenv 自身的信任文件，只在交互会话打开时应用已准备的环境。

## 使用

在 daemon 所在机器准备 Nix、devenv 和 Bash。自动重载不要求 `PATH` 中安装 Paseo CLI。开发仓库使用 Node 24、pnpm 和 Bend 2.0.32：

```sh
devenv shell
pnpm install --frozen-lockfile
pnpm --filter @paseo-plugins/devenv build:model
pnpm --filter @paseo-plugins/devenv build:skill
pnpm check
```

安装由用户自行执行；此仓库的开发与检查不会修改 daemon 配置：

```sh
pnpm exec paseo plugin install "$PWD/plugins/devenv"
pnpm exec paseo plugin reload devenv
```

插件从代理 cwd 的真实路径向上寻找最近的 `devenv.nix`，规范化符号链接。未授权项目显示 **untrusted**，不会求值。点击 composer 的 devenv pill 可检查项目路径并授权；显式执行 `/devenv-allow` 则授权当前项目并开始准备。这两种授权方式都会在准备成功后自动重载当前代理，以应用项目环境；后台任务不依赖面板保持打开。`/devenv-status` 打开状态面板，仅查询状态。面板也支持重新准备和刷新。

自动重载默认通过 Paseo daemon API 执行。插件从 daemon 的 `PASEO_HOME` 读取监听地址和本地凭据，支持 TCP 和本地 socket，不依赖宿主环境中的 `paseo` 命令。将 `paseoBin` 设置为其他值可显式使用自定义 CLI，并通过 `--home` 选择同一 daemon。同一代理的重复授权共享进行中的任务；准备失败、信任撤销、项目变化、代理删除或归档时不会重载。重载最多等待 60 秒，失败后面板显示错误并保留手动重载指引，状态轮询不会重试。关闭插件会取消准备和重载连接或子进程。通过外部信任文件授权、普通会话的后台准备和手动重新准备仍需用户重载代理。

会话最多等待 **25 秒**。超过预算后代理使用宿主环境启动，后台构建继续；环境准备完成后，界面显示 **reload required**。使用 Paseo 的代理重载操作，或运行面板给出的 `paseo agent reload <id>`，使下一次交互会话应用环境。历史会话读取不会构建或改变应用记录。

| 状态                       | 含义                                     |
| -------------------------- | ---------------------------------------- |
| untrusted                  | 项目未获信任                             |
| detected                   | 项目已信任，尚无当前配置的缓存           |
| loading                    | 环境正在准备                             |
| prepared / reload required | 环境已准备，当前代理尚未应用或使用旧版本 |
| applied                    | 最近完成的交互会话打开钩子已返回项目环境 |
| error                      | 构建失败，面板提供错误信息               |

`status` 描述缓存准备状态，`applied` 描述会话是否曾应用项目环境，`needsReload` 描述该环境是否需要更新。配置变化、重新准备或撤销信任不会清除运行中进程的环境；因此一个旧会话可以同时为 `applied=true` 和 `needsReload=true`。SDK 没有提供 provider 启动成功的回调，应用记录以会话打开钩子成功返回环境为准，不确认 provider 是否成功启动。

## 环境与缓存

`devenv direnv-export` 在项目根目录运行，Bash 对加载前后的 NUL 分隔环境做差量捕获。插件过滤 shell、终端及临时目录变量、`BASH_FUNC_*` 和大小写不敏感的 `PASEO_*`；调用方的显式变量覆盖项目差量。最后写入受管理的 `PASEO_DEVENV_ROOT` 和 `PASEO_DEVENV_STATUS`。变量删除不会传播给调用方。

构建按规范化项目根共享。`devenv.nix`、`devenv.yaml`、`devenv.lock`、`devenv.local.nix`、`devenv.local.yaml` 的时间和大小签名改变后，缓存失效。加载结束和会话注入前再次检查信任及签名。缓存容量满时等待活动构建，随后淘汰已完成条目。失败在重试间隔内不会由会话自动重试；面板的重新准备可显式重试。关闭插件会取消并等待其子进程。

信任文件按 `$DEVENV_HOME/allowed`、`$XDG_DATA_HOME/devenv/allowed`、`$HOME/.local/share/devenv/allowed` 的优先级读取。路径规范化后逐项匹配。`direnv allow` 使用独立的信任记录，不等同于 devenv 授权。

通过 devenv pill 或 `/devenv-allow` 授权 Git worktree 时，插件分别运行 `devenv allow`，授权当前 worktree 项目和主仓库中相同相对路径的 devenv 项目。确认界面展示两个项目路径。其他 worktree 随后继承主仓库项目的信任，无须逐个授权。嵌套项目只授权对应的主仓库嵌套项目，不扩大到仓库根。插件校验 Git 的双向 worktree 元数据和主仓库项目目录；找不到有效的对应主项目时仅授权当前项目。单独在终端运行 `devenv allow` 只授权该命令所在项目。

主仓库撤销信任后，其他 worktree 的继承信任立即失效；通过插件授权过的 worktree 自身仍保留显式授权。撤销两者需要分别在各自项目运行 `devenv revoke`。

新 worktree 的环境仍在自身项目根目录求值并独立缓存，MCP 使用相同的信任规则。已信任主仓库的新 worktree 可在第一次会话打开时准备并应用环境，无须重复授权；构建超过 25 秒预算时仍需等待完成后重载代理。

环境在会话层生效。代理切换命令 cwd 后仍使用同一会话环境；另一项目应使用另一代理。新代理保留已有 `systemPrompt`，依次追加插件说明和随包捆绑的 devenv 技能（`skills/devenv/SKILL.md`，经 `server/skill.generated.ts` 内联），并获得信任检查后的 `devenv mcp` 启动配置。已有同名 MCP 配置优先。Paseo 0.10.2 没有插件技能挂载接口，因此技能内容通过代理提示交付而非 `skill://`；`verify/skill.mjs` 保证交付文本与随包文件逐字节一致。MCP 配置在创建时交付；已有代理重载仍能获得环境。

## 设置和 RPC

Settings → devenv 提供以下宿主设置，修改后缓存失效：

| 设置              | 默认值                                            |
| ----------------- | ------------------------------------------------- |
| `devenvBin`       | `devenv`                                          |
| `paseoBin`        | `paseo`（默认使用 daemon API；其他值为 CLI 覆盖） |
| `loadTimeoutMs`   | `120000`                                          |
| `failureRetryMs`  | `60000`                                           |
| `maxRoots`        | `8`                                               |
| `maxCaptureBytes` | `8388608`                                         |
| `runtimeDir`      | 空字符串，保留宿主的 `XDG_RUNTIME_DIR`            |

三个插件 RPC 为 `devenv.status`、`devenv.allow`、`devenv.load`。输入严格验证 `{ agentId: string }`，输出为验证过的 `{ root, mainRoot, status, applied, needsReload, autoReload, error }`。`mainRoot` 是授权动作同时信任的主仓库项目路径，无有效对应项目时为 `null`。`autoReload` 表示授权后的准备或自动重载任务仍在进行。`status` 只读；`allow` 运行授权并在后台准备，成功后自动重载该代理，`load` 显式重新准备。授权会允许这些项目的 Nix 配置以 daemon 用户权限执行。

## 验证

```sh
pnpm --filter @paseo-plugins/devenv verify
pnpm test:e2e
pnpm --filter @paseo-plugins/devenv exec npm pack --dry-run
```

行为测试全部使用 E2E：启动隔离的真实 Paseo daemon，通过真实 Web UI、RPC、devenv/Nix 和 OpenCode 进程验证插件。测试需要 Linux、Nix、devenv、Bash、OpenCode 和 Chromium，不再提供单元测试或可选真实测试开关；缺少依赖会失败。测试不发送模型请求，项目、provider 数据与信任目录均为临时目录。失败日志、浏览器截图和 trace 保存在仓库的 `test-results/`。冷构建可能需要数分钟。详见 [E2E skill](../../skills/paseo-plugin-e2e/SKILL.md)。Bend 仅用于开发和静态验证，Paseo 安装时直接编译包含已提交模型产物的插件源码，无须 Bend。

[验证说明](verify/README.md) 区分 Bend2 原生证明、产物检查与真实 E2E；[来源](PROVENANCE.md) 记录参考实现和移植差异。真实 E2E 断言随包技能存在，并断言交付给项目代理的 `systemPrompt` 与 `skills/devenv/SKILL.md` 逐字节一致，且 `devenv` MCP 启动配置指向该项目。
