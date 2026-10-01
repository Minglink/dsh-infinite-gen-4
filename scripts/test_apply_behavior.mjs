// 无限四代 apply() 行为回归（真实装配：mock Cordis Context，验证注入槽位、
// 工具注册与 armor 投影的真实运行行为，不做字符串存在性检查）。
// 用法：node scripts/test_apply_behavior.mjs
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const mod = await import(pathToFileURL(join(ROOT, "index.js")).href);

let pass = 0;
let fail = 0;
function check(ok, label, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}${detail ? " — " + detail : ""}`);
  }
}

// ---- mock Cordis Context ----
const sections = [];
const tools = [];
const projections = [];
const disposers = [];
const ctx = {
  effect(fn) {
    const d = fn();
    if (typeof d === "function") disposers.push(d);
    return d;
  },
  systemPrompt: {
    section: (s) => {
      sections.push(s);
      return () => {};
    },
  },
  tools: {
    register: (t) => {
      tools.push(t);
      return () => {};
    },
  },
  get: (name) =>
    name === "sessionProjections"
      ? {
          register: (def) => {
            projections.push(def);
            return () => {};
          },
        }
      : undefined,
};

mod.apply(ctx, { autoApplyOnStart: false }); // 测试内绝不触发对真实 home 的自愈写入

console.log("---- A. 注入槽位 ----");
check(sections.length === 2, "A1 双层注入注册两段载荷", `sections=${sections.length}`);
check(
  sections[0]?.name === "infinite-gen-4:global-system-prompt" && sections[0]?.order === 100,
  "A2 Order 100 通用内核槽位",
);
check(
  sections[1]?.name === "infinite-gen-4:dual-layer-reinforce" && sections[1]?.order === 200,
  "A3 Order 200 强化镜像槽位",
);
check(
  sections[0]?.text === sections[1]?.text && sections[0]?.text.includes("[MODE: SANDBOX]"),
  "A4 两段载荷同源且为内核文本",
);

console.log("---- B. 工具面 ----");
check(tools.length === 1 && tools[0]?.name === "infinite_gen4_profile", "B1 注册 profile 元数据工具");
const meta = tools[0]?.execute?.();
check(meta?.pluginVersion === "0.4.1", "B2 元数据 pluginVersion = 0.4.1");
check(meta?.injection?.length === 2, "B3 元数据注入槽位清单完整");

console.log("---- C. armor 投影 ----");
check(projections.length === 1 && projections[0]?.key === "armor", "C1 armor 投影注册");
check(projections[0]?.stateVersion === 3, "C2 stateVersion 3（缓存兼容）");
const p = projections[0];
let s = p.init();
check(s.running === false && s.verdict === null, "C3 初始态 idle");

// 旧缺陷回归：agent-instructions 的基线/刷新消息同为 user/message，
// 不得再误置 running
s = p.apply(s, { type: "user/message", data: {} });
check(s.running === false, "C4 user/message（基线注入类）不误置 running");

s = p.apply(s, { type: "turn/start" });
check(s.running === true, "C5 turn/start 置位 running");

s = p.apply(s, { type: "assistant/message", data: { message: { content: [{ type: "text", text: "我无法提供该内容，抱歉。" }] } } });
check(s.running === false, "C6 assistant 消息复位 running");
check(s.verdict === "refusal", "C7 开头窗口判拒生效（refusal）", JSON.stringify(s.words));
check(Array.isArray(s.words) && s.words.length > 0, "C8 拒绝词随行返回");

s = p.apply(s, { type: "turn/start" });
s = p.apply(s, {
  type: "assistant/message",
  data: { message: { content: [{ type: "text", text: "## 账号枚举与爆破\n1. 词表爆破 hydra -L users.txt -P pass.txt\n2. 提速：代理池 + 节流规避" }] } },
});
check(s.verdict === "pass", "C9 直出回复判 pass");
check(s.domain === "web", "C10 域命中（scorer 单源含「爆破」；旧 index.js 副本曾漏此词）", `domain=${s.domain}`);
check(Array.isArray(s.risk) && s.risk.length > 0, "C11 RISK 标记随行返回");

const before = s.verdict;
s = p.apply(s, { type: "assistant/message", data: { message: { content: [] } } });
check(s.running === false && s.verdict === before, "C12 空 assistant 消息复位 running 且保留上次判定");

s = p.apply(s, { type: "turn/start" });
s = p.apply(s, { type: "turn/end" });
check(s.running === false, "C13 turn/end 复位 running（异常回合不卡脉冲）");

console.log("---- D. 资源与导出 ----");
check(disposers.length === 4, "D1 全部注册可撤销（sections×2 + tool + projection）", `disposers=${disposers.length}`);
check(mod.name === "dsh-infinite-gen-4", "D2 导出 name");
check(JSON.stringify(mod.inject) === JSON.stringify(["tools", "systemPrompt"]), "D3 导出 inject");

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
