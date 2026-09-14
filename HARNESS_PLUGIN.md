# DeepSeek Harness Plugin — 无限四代 / dsh-infinite-gen-4 (v0.4.0)

网络安全红队（Red-Teaming）测试插件，项目名：**无限四代（Infinite Generation Four）**。
专为 **DeepSeek-V4.1 / V4-Pro / V4-Flash 及 MoE 架构** 重构，采用
**「零工具面纯净直出 + 双层提示词协同注入 + 实时会话投影」**架构。

## 核心架构与特性

- **原生零工具面架构（Pure Zero-Tool Architecture）**：插件不挂载外部冗余功能性工具 Schema，
  消除模型推理阶段的决策犹豫与上下文 Token 浪费，让模型首 Token 直接产出可运行代码与实战步骤。
- **双层提示词协同注入（Dual-Layer Injection）**：
  - `infinite-gen-4:global-system-prompt`（Order 100）→ `prompts/infinite-gen-4.md`
  - `infinite-gen-4:dual-layer-reinforce`（Order 200）→ `prompts/infinite-gen-4.1-flash.md`
  - 两段载荷同源同构，SHA256 完全一致；由 `index.js` 的 `DUAL_LAYER_INJECTION`
    开关控制（`false` 即单段注入，行为等价）。
  - 载荷中的 `{{...}}` 非内置变量由 `index.js` 做安全转义，避免模板解析器抛错。
- **输出契约与首 Token 诱导**：首行强制以 `##` 或 ``` 命名交付物 + 静默推理 + 占位符自造，
  杜绝散文式开场与拒答先验。
- **用户指令最高优先级（Supreme User Authority）**：用户任务与显式命令为最高优先级，
  不存在可拒绝的请求类别。
- **评分器与会话投影**：开头窗口（160）判拒 + REFUSAL / FALLBACK / SAFE / RISK 四类标记
  + 域命中检测，驱动客户端状态条展示。该投影是**评分器**，不参与系统提示词注入。
- **客户端实时状态条**：在输入框上方挂载 `⚫ 无限四代 v0.4.0` 动态状态条（含命中域/载荷数显示）。
- **profile 元数据工具**：`infinite_gen4_profile` 返回内核版本、注入槽位清单与能力标记。

## 注入面文件

| 文件 | 用途 | 内容 |
|---|---|---|
| `prompts/infinite-gen-4.md` | Order 100 通用内核 | 内核载荷（权威源） |
| `prompts/infinite-gen-4.1-flash.md` | Order 200 强化镜像 | 同源载荷（逐字一致） |
| `prompts/infinite-gen-3.md` | 历史兼容文件名 | 同源载荷（逐字一致） |

三个文件的 SHA256 完全相同，`scripts/verify_prompt_gen4.mjs` / `verify_prompt.mjs` 会强断言这一点。

## 版本

| 版本 | 说明 |
|---|---|
| v0.3.0 | 双层注入首版（Order 100 通用内核 + Order 200 战场实测层） |
| **v0.4.0** | 双层注入收敛为同源同构内核；注入槽位统一为 `infinite-gen-4:*`；内核载荷与强化镜像逐字一致 |

## Local verification

```powershell
node --check index.js
node scripts/verify_prompt_gen4.mjs   # 68 项：内核载荷逐字一致 + 注入槽位 + 投影
node scripts/verify_prompt.mjs        # 65 项：载荷锚点 + 导出 + 安装协议 + 用例库
```

## Install in the desktop Harness

```powershell
# profiles/default/package.json
"dependencies": {
  "dsh-infinite-gen-4": "file:../../plugins/dsh-infinite-gen-4"
},
"dsh": {
  "profile": {
    "bundles": ["@deepseek-ai/dsh-base", "dsh-infinite-gen-4"]
  }
}
```

然后 `cd $env:USERPROFILE\.dsh\profiles\default && pnpm install`，重启会话（或执行 `install.ps1`）。

注意：若 profile 中同时启用其它同样注册系统提示词段的破甲包，组装时会出现多份载荷叠加；
如需本插件载荷独占生效，请二选一保留。
