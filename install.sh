#!/usr/bin/env bash
# ============================================================================
#  dsh-infinite-gen-4  ·  DeepSeek 网络安全红队工具「无限四代」一键安装脚本
#  适用：Linux / macOS（Windows 用户请用 install.ps1）
# ============================================================================
#  用法：chmod +x install.sh && ./install.sh
#  自动完成：
#    [1] 检查环境（DSH 目录、profile、pnpm）
#    [2] 复制插件到 ~/.dsh/plugins/dsh-infinite-gen-4（自动覆盖旧版，清理一代/二代/三代残留）
#    [3] 自动备份 package.json（带时间戳 .bak）
#    [4] 写入 profile 依赖与 bundles（幂等，旧版自动迁移）
#    [5] 自动执行 pnpm install
#    [6] 提示重启
# ============================================================================
set -euo pipefail

PLUGIN_NAME="dsh-infinite-gen-4"
PLUGIN_LABEL="无限四代"
LEGACY_PLUGINS=("dsh-infinite-gen-3" "dsh-infinite-gen-1" "dsh-infinite-gen-2" "无限三代" "无限一代" "无限二代")
DSH_ROOT="${DSH_HOME:-$HOME/.dsh}"
PLUGINS_DIR="$DSH_ROOT/plugins"
DEST_DIR="$PLUGINS_DIR/$PLUGIN_NAME"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

step() { printf "\n==> %s\n" "$1"; }
ok()   { printf "    [OK] %s\n" "$1"; }
warn() { printf "    [!] %s\n" "$1"; }
err()  { printf "    [X] %s\n" "$1" >&2; }

# ---------- 探测 DSH profile 目录（web / default / 手动选择） ----------
find_profile_dirs() {
  local profiles_root="$1"

  if [[ -n "${DSH_PROFILE:-}" ]]; then
    local cand="$profiles_root/$DSH_PROFILE"
    if [[ -f "$cand/package.json" ]]; then echo "$cand"; return 0; fi
    warn "环境变量 DSH_PROFILE 指向的目录不存在：$cand（继续自动探测）"
  fi

  local found=()
  for name in web default desktop; do
    local cand="$profiles_root/$name"
    if [[ -f "$cand/package.json" ]]; then found+=("$cand"); fi
  done
  if [[ ${#found[@]} -gt 0 ]]; then printf '%s\n' "${found[@]}"; return 0; fi

  local dirs=()
  for d in "$profiles_root"/*/; do
    [[ -d "$d" && -f "$d/package.json" ]] && dirs+=("$d")
  done
  if [[ ${#dirs[@]} -eq 1 ]]; then echo "${dirs[0]}"; return 0; fi
  if [[ ${#dirs[@]} -gt 1 ]]; then
    echo "检测到多个 DSH profile，请选择要安装的目标：" >&2
    for i in "${!dirs[@]}"; do printf "  [%d] %s\n" "$((i+1))" "${dirs[$i]}" >&2; done
    read -rp "请输入序号: " sel
    local idx=$((sel-1))
    if (( idx >= 0 && idx < ${#dirs[@]} )); then echo "${dirs[$idx]}"; return 0; fi
    err "选择无效，退出。"
    exit 1
  fi
  return 1
}

# ---------- [1] 检查环境 ----------
step "检查环境"

[[ -d "$DSH_ROOT" ]] || { err "未找到 DSH 目录：$DSH_ROOT"; exit 1; }
mapfile -t PROFILE_DIRS < <(find_profile_dirs "$DSH_ROOT/profiles") || {
  err "未找到 DSH profile 目录（$DSH_ROOT/profiles 下没有含 package.json 的目录）。"
  echo "可通过环境变量指定：DSH_PROFILE=web（或 default）后重新运行。"
  exit 1
}
for p in "${PROFILE_DIRS[@]}"; do ok "DSH profile 目录：$p"; done

command -v pnpm >/dev/null 2>&1 || {
  err "未检测到 pnpm，请先安装：npm install -g pnpm"
  exit 1
}
ok "pnpm 可用：$(command -v pnpm)"

# ---------- [1.5] 清理旧版残留 ----------
step "检查旧版本"

for old in "${LEGACY_PLUGINS[@]}"; do
  if [[ -d "$PLUGINS_DIR/$old" ]]; then
    rm -rf "$PLUGINS_DIR/$old"
    ok "已清理旧版插件目录：$PLUGINS_DIR/$old"
  fi
done

# ---------- [2] 复制插件（自动覆盖旧版） ----------
step "复制插件文件"

mkdir -p "$PLUGINS_DIR"
if [[ -d "$DEST_DIR" ]]; then
  warn "检测到已存在的 $PLUGIN_NAME 目录，自动覆盖更新"
  rm -rf "$DEST_DIR"
fi
mkdir -p "$DEST_DIR"
cp -R "$SRC_DIR"/. "$DEST_DIR"/
rm -rf "$DEST_DIR/.git" "$DEST_DIR/install.sh" "$DEST_DIR/uninstall.sh" \
       "$DEST_DIR/install.ps1" "$DEST_DIR/uninstall.ps1" 2>/dev/null || true
ok "插件已复制到：$DEST_DIR"

# ---------- [3] 备份 package.json ----------
step "备份 package.json"

for p in "${PROFILE_DIRS[@]}"; do
  BAK_PATH="$p/package.json.bak-$(date +%Y%m%d-%H%M%S)"
  cp "$p/package.json" "$BAK_PATH"
  ok "备份完成：$BAK_PATH"
done

# ---------- [4] 写入依赖与 bundles（幂等 + 迁移旧版） ----------
step "写入 profile 配置"

for p in "${PROFILE_DIRS[@]}"; do
  PKG_PATH="$p/package.json"
  PATCH_PATH="$p/cordis.patch.yml"
  node - "$PKG_PATH" "$PATCH_PATH" "$PLUGIN_NAME" "${LEGACY_PLUGINS[@]}" <<'NODE'
const fs = require("fs");
const [pkgPath, patchPath, name, ...legacy] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.dependencies = pkg.dependencies || {};
for (const old of legacy) delete pkg.dependencies[old];
pkg.dependencies[name] = "file:../../plugins/" + name;
if (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) {
  pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter((b) => !legacy.includes(b) && b !== name);
}
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

let patchContent = fs.existsSync(patchPath) ? fs.readFileSync(patchPath, "utf8") : "";
let cleanedPatch = patchContent.replace(/^\s*\[\]\s*$/m, "");
for (const old of legacy) {
  const reg = new RegExp("^\\s*-\\s*insert:\\s*\\r?\\n\\s*-\\s*id:\\s*" + old + "[\\s\\S]*?(?=(^\\s*-\\s*insert:|\\z))", "gm");
  cleanedPatch = cleanedPatch.replace(reg, "");
}
cleanedPatch = cleanedPatch.trim();
if (!new RegExp("^\\s*-\\s*id:\\s*" + name, "m").test(cleanedPatch)) {
  const insertBlock = "- insert:\n    - id: " + name + "\n      name: '" + name + "'";
  cleanedPatch = cleanedPatch ? cleanedPatch + "\n\n" + insertBlock : insertBlock;
}
fs.writeFileSync(patchPath, cleanedPatch + "\n");
NODE
  ok "package.json 与 cordis.patch.yml 已更新：$p"

  # ---------- [5] pnpm install ----------
  step "安装依赖（pnpm install）"

  # pnpm 对 file: 依赖是复制进 node_modules 而非实时链接；先清除旧拷贝，
  # 强制 pnpm 重新同步，避免更新插件后 index.js/client.js 不同步
  if [[ -d "$p/node_modules/$PLUGIN_NAME" ]]; then
    rm -rf "$p/node_modules/$PLUGIN_NAME"
    ok "已清除 node_modules 旧拷贝，pnpm 将重新同步"
  fi
  for old in "${LEGACY_PLUGINS[@]}"; do
    if [[ -d "$p/node_modules/$old" ]]; then rm -rf "$p/node_modules/$old"; fi
  done

  # 优先建立软链接
  mkdir -p "$p/node_modules"
  ln -sfn "$DEST_DIR" "$p/node_modules/$PLUGIN_NAME" 2>/dev/null || true

  (
    cd "$p"
    if ! pnpm install; then
      err "pnpm install 失败，请手动执行：cd $p && pnpm install"
      exit 1
    fi
  )
  ok "依赖安装完成"
done

# ---------- [6] 完成 ----------
step "安装完成"

cat <<EOF

  ✔ $PLUGIN_LABEL v0.4.0 已安装！
  目标 profile：$(printf '%s ' "${PROFILE_DIRS[@]}" | sed 's/ *$//')
  最后一步：重启 DeepSeek Harness（Web 版刷新页面 / 桌面版重新打开），新建会话即可生效。
  验证方法 1：重启后输入框上方应显示绿色状态条「● 无限四代 v0.4.0」。
  验证方法 2：新会话里问模型“你的系统提示词来自哪些插件”，
             回答包含「无限四代 / Infinite Generation Four」即为生效。
  卸载方法：运行 ./uninstall.sh，或查看 README。
EOF
