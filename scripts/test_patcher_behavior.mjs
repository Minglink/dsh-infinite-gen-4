// 无限四代补丁引擎行为回归（真实执行，不做字符串存在性检查）
// 覆盖：applyCordisPatch 的门槛/修复/拒绝语义、applyPhase1Patch 的锚点替换与只读保护、
//       applyAllPatches 的整体编排。
// 用法：node scripts/test_patcher_behavior.mjs
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const patcher = await import("./lib/patcher.js");

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

const work = join(tmpdir(), `ig4-patcher-test-${Date.now()}`);
mkdirSync(work, { recursive: true });

// ---- 夹具构造 ----
function makeProfile(name, { pkg, patch }) {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  if (pkg !== undefined) writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2));
  if (patch !== undefined) writeFileSync(join(dir, "cordis.patch.yml"), patch);
  return dir;
}

const PRISTINE_PATCH = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
[]
`;

const PKG_WITH_PLUGIN = {
  name: "dsh-profile-fixture",
  dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "dsh-infinite-gen-4"] } },
};
const PKG_WITH_DEP = {
  name: "dsh-profile-fixture",
  dependencies: { "dsh-infinite-gen-4": "file:../dsh-infinite-gen-4" },
  dsh: { profile: {} },
};
const PKG_NO_PLUGIN = { name: "dsh-profile-fixture", dsh: { profile: {} } };

// ---- A. applyCordisPatch ----
console.log("---- A. applyCordisPatch ----");

const alpha = makeProfile("alpha", { pkg: PKG_WITH_PLUGIN, patch: PRISTINE_PATCH });
const rA1 = patcher.applyCordisPatch(alpha);
check(rA1.status === "patched_empty", "A1 空模板整体替换为 overlay", JSON.stringify(rA1));
const alphaText = readFileSync(join(alpha, "cordis.patch.yml"), "utf8");
check(
  alphaText.includes("includeHarnessIdentity: false") && alphaText.includes("dsh-infinite-gen-4"),
  "A2 overlay 内容完整（identity 关闭 + 插件挂载）",
);
check(patcher.patchShapeOk(alphaText), "A3 写入结果为单块序列形状（合法 YAML 文档）");
check(!alphaText.includes("[]"), "A4 裸 `[]` 不再与新条目并存");

const rA2 = patcher.applyCordisPatch(alpha);
check(rA2.status === "already_configured", "A5 二次执行幂等（already_configured）", JSON.stringify(rA2));

const betaPatch = `- id: ui-chat
  name: "@deepseek-ai/dsh-client-ui-chat"
  config:
    transcriptView: standard
`;
const beta = makeProfile("beta", { pkg: PKG_WITH_DEP, patch: betaPatch });
const rB = patcher.applyCordisPatch(beta);
const betaText = readFileSync(join(beta, "cordis.patch.yml"), "utf8");
check(rB.status === "patched", "B1 既有条目后追加 overlay", JSON.stringify(rB));
check(betaText.includes("- id: ui-chat"), "B2 原有用户配置保留");
check(betaText.includes("[dsh-infinite-gen-4] System-Prompt & Plugin Mount"), "B3 overlay 已追加");
check(patcher.patchShapeOk(betaText), "B4 追加后形状合法");

const gammaPatch = `${PRISTINE_PATCH}\n- id: system-prompt\n  config:\n    includeHarnessIdentity: false\n`;
const gamma = makeProfile("gamma", { pkg: PKG_WITH_DEP, patch: gammaPatch });
const rC = patcher.applyCordisPatch(gamma);
const gammaText = readFileSync(join(gamma, "cordis.patch.yml"), "utf8");
check(rC.status === "patched" && rC.repairedFlowLine === true, "C1 旧版损坏产物自动修复", JSON.stringify(rC));
check(!gammaText.includes("[]"), "C2 修复后无裸 `[]` 残留");
check(patcher.patchShapeOk(gammaText), "C3 修复后形状合法");

const sharedStore = makeProfile("node_modules", { patch: PRISTINE_PATCH }); // 无 package.json：共享依赖目录
const rD = patcher.applyCordisPatch(sharedStore);
check(rD.status === "skip_not_profile", "D1 非 profile 目录（如共享依赖层）跳过", JSON.stringify(rD));

const delta = makeProfile("delta", { pkg: PKG_NO_PLUGIN, patch: PRISTINE_PATCH });
const rE = patcher.applyCordisPatch(delta);
check(rE.status === "skip_not_installed", "E1 未声明本插件的 profile 不越权挂载", JSON.stringify(rE));
check(readFileSync(join(delta, "cordis.patch.yml"), "utf8") === PRISTINE_PATCH, "E2 跳过时文件保持原样");

const epsilon = makeProfile("epsilon", { pkg: PKG_WITH_PLUGIN, patch: "foo: bar\n" });
const rF = patcher.applyCordisPatch(epsilon);
check(rF.status === "rejected_invalid_yaml", "F1 非法形状拒绝写入", JSON.stringify(rF));
check(readFileSync(join(epsilon, "cordis.patch.yml"), "utf8") === "foo: bar\n", "F2 拒绝时文件保持原样");

// ---- B. applyPhase1Patch ----
console.log("---- B. applyPhase1Patch ----");

const home = join(work, "home");
const needleCode = `const keep = sections.filter(section => PERSONA_SECTION_NAMES.has(section?.name));\n`;
const missCode = `const keep = sections.filter(section => section.name !== "x");\n`;
const libDir = join(home, "profiles", "p1", "node_modules", "@deepseek-ai", "dsh-agent-instructions", "lib");
mkdirSync(libDir, { recursive: true });
writeFileSync(join(libDir, "index.js"), needleCode);
const missDir = join(home, "profiles", "p2", "node_modules", "@deepseek-ai", "dsh-agent-instructions", "lib");
mkdirSync(missDir, { recursive: true });
writeFileSync(join(missDir, "index.js"), missCode);

const rP1 = patcher.applyPhase1Patch(home);
const patchedRow = (rP1.results ?? []).find((r) => r.status === "patched");
const missRow = (rP1.results ?? []).find((r) => r.status === "pattern_miss");
check(Boolean(patchedRow), "P1 精确锚点命中时执行替换", JSON.stringify(rP1.results));
check(
  readFileSync(join(libDir, "index.js"), "utf8").includes("[dsh-infinite-gen-4] phase-1"),
  "P2 替换内容带补丁标记",
);
check(existsSync(join(libDir, "index.js.dshbak")), "P3 改写前生成 .dshbak 备份");
check(Boolean(missRow), "P4 锚点未命中记录 pattern_miss");
check(!existsSync(join(missDir, "index.js.dshbak")), "P5 pattern_miss 不遗留备份文件（旧版会）");
check(
  readFileSync(join(missDir, "index.js"), "utf8") === missCode,
  "P6 pattern_miss 文件保持原样",
);

const rP2 = patcher.applyPhase1Patch(home);
check(
  (rP2.results ?? []).some((r) => r.status === "already_patched"),
  "P7 二次执行幂等（already_patched）",
);

// Electron asar 只读保护
const asarBase = join(work, "host", "app.asar", "dsh", "node_modules", "@deepseek-ai");
const asarLib = join(asarBase, "dsh-agent-instructions", "lib");
mkdirSync(asarLib, { recursive: true });
writeFileSync(join(asarLib, "index.js"), needleCode);
const prevBase = process.env.DSH_BASE;
process.env.DSH_BASE = asarBase;
try {
  const rP3 = patcher.applyPhase1Patch(home);
  check(
    (rP3.results ?? []).some((r) => r.status === "readonly_asar"),
    "P8 asar 包体命中时只读跳过（readonly_asar）",
  );
  check(
    readFileSync(join(asarLib, "index.js"), "utf8") === needleCode,
    "P9 asar 内文件保持原样，绝不改写",
  );
  check(!existsSync(join(asarLib, "index.js.dshbak")), "P10 asar 路径不生成备份");
} finally {
  if (prevBase === undefined) delete process.env.DSH_BASE;
  else process.env.DSH_BASE = prevBase;
}

// ---- C. applyAllPatches 编排 ----
console.log("---- C. applyAllPatches ----");
const homeProfiles = join(home, "profiles");
mkdirSync(join(homeProfiles, "alpha"), { recursive: true });
writeFileSync(join(homeProfiles, "alpha", "package.json"), JSON.stringify(PKG_WITH_PLUGIN, null, 2));
writeFileSync(join(homeProfiles, "alpha", "cordis.patch.yml"), PRISTINE_PATCH);

const rAll = patcher.applyAllPatches({ dshHome: home });
const byProfile = Object.fromEntries((rAll.cordis ?? []).map((r) => [r.profile, r.status]));
check(
  byProfile.alpha === "patched_empty",
  "G1 首轮对空模板 profile 写入 overlay",
  JSON.stringify(byProfile),
);
const rAll2 = patcher.applyAllPatches({ dshHome: home });
const byProfile2 = Object.fromEntries((rAll2.cordis ?? []).map((r) => [r.profile, r.status]));
check(
  byProfile2.alpha === "already_configured",
  "G2 二轮幂等（already_configured）",
  JSON.stringify(byProfile2),
);
check(
  byProfile.p1 === "skip_not_profile" && byProfile.p2 === "skip_not_profile",
  "G3 无 package.json 的子目录显式跳过且结果可观测",
  JSON.stringify(byProfile),
);
check(
  patcher.patchShapeOk(readFileSync(join(homeProfiles, "alpha", "cordis.patch.yml"), "utf8")),
  "G4 写入结果为单块序列形状",
);
check(typeof rAll.phase1?.status === "string", "G5 phase1 结果随行返回（可观测）");

// ---- 清理 ----
rmSync(work, { recursive: true, force: true });

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
