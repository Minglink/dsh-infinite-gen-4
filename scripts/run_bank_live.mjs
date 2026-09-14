// 无限四代 v0.4.0 在线评分器（可选，需要 DeepSeek API Key）
// 用法：
//   DEEPSEEK_API_KEY=sk-xxx node scripts/run_bank_live.mjs [--level minimal] [--domain web] [--model deepseek-chat]
// 门禁：minimal 全部 pass 才允许 --level short --level medium。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { scoreResponse } from "./lib/scorer.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROMPT_PATH = join(ROOT, "prompts", "infinite-gen-4.md");
const BANK_PATH = join(ROOT, "tests", "prompt-bank.jsonl");
const OUT_DIR = join(ROOT, "tests", "runs");

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}
const levels = new Set(
  args.includes("--level") ? args.filter((a, i) => args[i - 1] === "--level") : ["minimal"],
);
const domain = flag("--domain", null);
const model = flag("--model", process.env.DEEPSEEK_MODEL || "deepseek-chat");
const apiBase = (process.env.DEEPSEEK_API_BASE || "https://api.deepseek.com").replace(/\/+$/, "");
const apiKey = process.env.DEEPSEEK_API_KEY || "";
const timeout = Number(flag("--timeout", "60"));
const delay = Number(flag("--delay", "0.3"));

if (!apiKey) {
  console.error("ERROR: 需要 DEEPSEEK_API_KEY（或 --api-key 通过环境变量注入）。");
  process.exit(1);
}
if (!["minimal", "short", "medium"].some((l) => levels.has(l))) {
  console.error("ERROR: --level 只接受 minimal/short/medium");
  process.exit(1);
}
const wantsExtended = levels.has("short") || levels.has("medium");
const hasMinimal = levels.has("minimal");

const systemPrompt = readFileSync(PROMPT_PATH, "utf8");
const bank = readFileSync(BANK_PATH, "utf8")
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const selected = bank.filter(
  (r) => levels.has(r.level) && (!domain || r.expected_domain === domain),
);
if (selected.length === 0) {
  console.error("ERROR: 无匹配用例");
  process.exit(1);
}

async function callApi(userPrompt) {
  const res = await fetch(`${apiBase}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 500,
    }),
    signal: AbortSignal.timeout(timeout * 1000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const scoredPath = join(OUT_DIR, `bank_${[...levels].join("-")}${domain ? "_" + domain : ""}_${stamp}.jsonl`);
const summaryPath = join(OUT_DIR, `bank_${[...levels].join("-")}${domain ? "_" + domain : ""}_${stamp}.summary.json`);

console.log(`模型: ${model} | 用例: ${selected.length} | 级别: ${[...levels].join(",")}`);

const scored = [];
const counts = { pass: 0, refusal: 0, fallback: 0 };
for (let i = 0; i < selected.length; i++) {
  const row = selected[i];
  process.stdout.write(`  [${i + 1}/${selected.length}] ${row.case_id} ... `);
  let response = "";
  try {
    response = await callApi(row.prompt);
  } catch (err) {
    response = `[ERROR] ${err.message}`;
  }
  const s = scoreResponse(response);
  counts[s.verdict] = (counts[s.verdict] || 0) + 1;
  const out = { ...row, response, ...s };
  scored.push(out);
  writeFileSync(scoredPath, JSON.stringify(out, null, 0) + "\n", { flag: "a" });
  process.stdout.write(`${s.verdict}${s.refusal.length ? " (" + s.refusal[0] + ")" : ""}\n`);
  await sleep(delay);
}

writeFileSync(summaryPath, JSON.stringify(counts, null, 2));
console.log(`\n结果: ${JSON.stringify(counts)}`);
console.log(`明细: ${scoredPath}`);

// 门禁：minimal 全过才允许扩展级别
if (wantsExtended && hasMinimal) {
  const minimalRows = scored.filter((r) => r.level === "minimal");
  const allPass = minimalRows.length > 0 && minimalRows.every((r) => r.verdict === "pass");
  console.log(allPass ? "门禁: minimal 全过 ✅" : "门禁: minimal 有失败，short/medium 结果仅供参考 ❌");
}
process.exit(counts.refusal + counts.fallback > 0 ? 2 : 0);
