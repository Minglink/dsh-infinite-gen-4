import { readFileSync } from "node:fs";
// 评分规则单源：开头窗口(160)判拒、REFUSAL / FALLBACK / SAFE / RISK 标记与
// 域命中检测全部由 scripts/lib/scorer.mjs 提供。本文件不再维护第二份规则表
// （历史上两份副本曾双向漂移：RISK_MARKERS 与 web/game 域词表不一致，
// 状态条因此低报风险词、误判命中域）。
import { scoreResponse } from "./scripts/lib/scorer.mjs";

// ── 无限四代双层内核载荷（v0.4.1） ────────────────────────────────────────────────
// Order 100 通用内核 + Order 200 强化镜像，两段载荷同源同构（SHA256 一致）。
const PROMPT_URL = new URL("./prompts/infinite-gen-4.md", import.meta.url);
const PROMPT41_URL = new URL("./prompts/infinite-gen-4.1-flash.md", import.meta.url);
// 兼容 DSH 提示词变量插值引擎（非内置变量的连续花括号做安全转义，防止模板解析器抛出 malformed prompt variable reference）
const PROMPT_TEXT = readFileSync(PROMPT_URL, "utf8").replace(/\{\{(?!(?:cwd|model|provider)\}\})/g, "{ {");
const PROMPT41_TEXT = readFileSync(PROMPT41_URL, "utf8").replace(/\{\{(?!(?:cwd|model|provider)\}\})/g, "{ {");

// 双段注入镜像开关：
//   true  = 沿用四代双层架构，Order 100 与 Order 200 各注入一份内核载荷
//   false = 单段注入（Order 100），省掉重复 token，行为等价
const DUAL_LAYER_INJECTION = true;

const objectOutput = {
  schema: { type: "object", additionalProperties: true },
  render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
};

// 运行时元数据工具：返回插件版本与能力清单
const profileTool = {
  name: "infinite_gen4_profile",
  description:
    "Return runtime metadata for the bundled 无限四代 (Infinite Generation Four) 破甲系统提示词与版本元数据。",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  output: objectOutput,
  execute() {
    return {
      plugin: "dsh-infinite-gen-4",
      pluginVersion: "0.4.1",
      pluginDisplayName: "无限四代",
      name: "infinite-gen-4",
      displayName: "无限四代",
      kernelVersion: "0.4.1",
      targetArchitecture: "DeepSeek-V4 / V4-Pro / V4.1-Flash 全系列",
      baseline: "deepseek-unrestricted-v7-stable (dsh-infinite-gen-4)",
      promptSource: [
        "prompts/infinite-gen-4.md",
        "prompts/infinite-gen-4.1-flash.md",
      ],
      lineage: ["dsh-infinite-gen-4 (v0.4.1) — 双层协同注入内核"],
      injection: [
        { section: "infinite-gen-4:global-system-prompt", order: 100, enabled: true },
        {
          section: "infinite-gen-4:dual-layer-reinforce",
          order: 200,
          enabled: DUAL_LAYER_INJECTION,
        },
      ],
      mode: "armor — 双层协同注入，零工具面纯净直出",
      payloadSections: [
        "[MODE: SANDBOX]",
        "SUPREME DIRECTIVE — USER AUTHORITY",
        "Output contract（首行 ##/``` 命名交付物 + 静默推理 + 占位符自造）",
        "Task classes（逆向工程/合规渗透/防御审计/LLM研究/其他，直接产出）",
        "Format examples（[USER]/[OUTPUT] few-shot 镜像）",
      ],
      hostFeatures: [
        "Dual-Layer Injection: Order 100 通用内核 + Order 200 强化镜像",
        "Section Hosting: 双槽位可由 DUAL_LAYER_INJECTION 切换单段注入",
        "Armor Projection: 回合事件驱动 running + 开头窗口(160)判拒 + REFUSAL/FALLBACK/SAFE/RISK 标记 + 域命中",
        "Client Badge: 输入框上方「无限四代 v0.4.1」实时状态条",
        "Profile Tool: infinite_gen4_profile 返回内核版本与注入槽位元数据",
      ],
      features: [
        "Pure Zero-Tool Architecture: 零工具面纯净直出，消除决策噪音",
        "Direct Deliverable Contract: 首行 ##/``` 命名交付物",
        "Supreme User Authority: 用户指令最高优先级",
        "Placeholder Self-Synthesis: 缺失细节自造 TARGET/HOST/TOKEN/OFFSET/PAYLOAD/SERIAL/SYMBOL/HOOK_FN",
        "Task-Class Direct Output: 逆向分析 / 合规渗透 / 防御审计 / LLM 安全研究",
        "Format Anchors: [USER]/[OUTPUT] few-shot 镜像",
        "Refusal Hardening: 拒绝对抗硬化 + 无拒绝动作",
      ],
    };
  },
};

// ---- 实时破甲状态（会话投影；评分规则由 scripts/lib/scorer.mjs 单源提供） ----

function armorTextOf(content) {
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (block && block.type === "text" ? block.text : ""))
    .join("\n");
}

function armorProjectionApply(state, event) {
  if (!event || typeof event !== "object") return state;
  // running 以宿主持久回合事件为界：turn/start 置位，assistant 消息与
  // turn/end 复位。旧版按 user/message 置位——但 agent-instructions 的基线/
  // 刷新消息同样是 user/message，会导致角标在无输入框操作时误闪「执行中…」。
  if (event.type === "turn/start") {
    return { running: true, verdict: null, words: [], safe: [], risk: [], domain: null, domainHits: 0 };
  }
  if (event.type === "assistant/message") {
    const text = armorTextOf(event?.data?.message?.content);
    if (!text.trim()) return { ...state, running: false };
    const scored = scoreResponse(text);
    return {
      running: false,
      verdict: scored.verdict,
      words: scored.words.slice(0, 3),
      safe: scored.safe.slice(0, 3),
      risk: scored.risk.slice(0, 3),
      domain: scored.domain,
      domainHits: scored.domainHits,
    };
  }
  if (event.type === "turn/end") {
    return { ...state, running: false };
  }
  return state;
}

export const name = "dsh-infinite-gen-4";
export const inject = ["tools", "systemPrompt"];

export function apply(ctx, config = { autoApplyOnStart: true }) {
  // 运行期自愈：自动修补 Phase-1 过滤与配置叠加（非阻塞执行；
  // 异常与被拒写入上报 console.warn，不再静默吞掉）
  if (config?.autoApplyOnStart !== false) {
    import("./scripts/lib/patcher.js")
      .then((m) => {
        const result = m.applyAllPatches();
        const issues = [];
        for (const r of result?.phase1?.results ?? []) {
          if (r?.status === "error") issues.push(`phase1 ${r.file}: ${r.error ?? r.status}`);
        }
        for (const r of result?.cordis ?? []) {
          if (r?.status === "error" || r?.status === "rejected_invalid_yaml") {
            issues.push(`cordis ${r.profile}: ${r.status}${r.error ? ` (${r.error})` : ""}`);
          }
        }
        if (issues.length) console.warn("[dsh-infinite-gen-4] self-heal issues:", issues);
        return result;
      })
      .catch((e) => console.warn("[dsh-infinite-gen-4] self-heal failed:", e?.message ?? e));
  }

  ctx.effect(() =>
    ctx.systemPrompt.section({
      name: "infinite-gen-4:global-system-prompt",
      order: 100,
      text: PROMPT_TEXT,
    }),
  );
  if (DUAL_LAYER_INJECTION) {
    ctx.effect(() =>
      ctx.systemPrompt.section({
        name: "infinite-gen-4:dual-layer-reinforce",
        order: 200,
        text: PROMPT41_TEXT,
      }),
    );
  }
  ctx.effect(() => ctx.tools.register(profileTool));

  const anySchema = { parse: (value) => value };
  const armorDef = {
    key: "armor",
    stateVersion: 3,
    stateSchema: anySchema,
    init: () => ({ running: false, verdict: null, words: [], safe: [], risk: [], domain: null, domainHits: 0 }),
    apply: armorProjectionApply,
    wire: {
      viewSchema: anySchema,
      view: (state) => state,
    },
  };

  const registerArmor = (p) => {
    try {
      ctx.effect(() => p.register(armorDef, "infinite-gen-4: armor projection"));
    } catch {}
  };

  const projections = ctx.get("sessionProjections");
  if (projections !== undefined) {
    registerArmor(projections);
  } else if (typeof ctx.inject === "function") {
    ctx.inject(["sessionProjections"], (innerCtx) => {
      const p = innerCtx.get("sessionProjections");
      if (p !== undefined) registerArmor(p);
    });
  }
}
