#!/usr/bin/env bash
set -euo pipefail

PLUGIN_NAME="dsh-infinite-gen-4"
LEGACY_PLUGINS=("dsh-infinite-gen-4" "dsh-infinite-gen-3" "dsh-infinite-gen-1" "dsh-infinite-gen-2")
DSH_ROOT="${DSH_HOME:-$HOME/.dsh}"
PLUGINS_DIR="${DSH_ROOT}/plugins"

echo "==> 查找 profile 配置..."
for name in web default desktop; do
  pDir="${DSH_ROOT}/profiles/${name}"
  pkgPath="${pDir}/package.json"
  patchPath="${pDir}/cordis.patch.yml"

  if [[ -f "${pkgPath}" ]]; then
    node - "${pkgPath}" "${patchPath}" "${LEGACY_PLUGINS[@]}" <<'NODE'
const fs = require("fs");
const [pkgPath, patchPath, ...legacy] = process.argv.slice(2);
if (fs.existsSync(pkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  let changed = false;
  if (pkg.dependencies) {
    for (const old of legacy) {
      if (pkg.dependencies[old]) { delete pkg.dependencies[old]; changed = true; }
    }
  }
  if (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) {
    pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter(b => !legacy.includes(b));
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    console.log("    [OK] package.json 已更新: " + pkgPath);
  }
}

if (fs.existsSync(patchPath)) {
  let patchContent = fs.readFileSync(patchPath, "utf8");
  for (const old of legacy) {
    const reg = new RegExp("^\\s*-\\s*insert:\\s*\\r?\\n\\s*-\\s*id:\\s*" + old + "[\\s\\S]*?(?=(^\\s*-\\s*insert:|\\z))", "gm");
    patchContent = patchContent.replace(reg, "");
  }
  fs.writeFileSync(patchPath, patchContent.trim() + "\n");
  console.log("    [OK] cordis.patch.yml 已更新: " + patchPath);
}
NODE

    for old in "${LEGACY_PLUGINS[@]}"; do
      rm -rf "${pDir}/node_modules/${old}" 2>/dev/null || true
    done

    (cd "${pDir}" && pnpm install >/dev/null 2>&1 || true)
  fi
done

for old in "${LEGACY_PLUGINS[@]}"; do
  if [[ -d "${PLUGINS_DIR}/${old}" ]]; then
    rm -rf "${PLUGINS_DIR}/${old}"
    echo "    [OK] 已删除插件目录: ${PLUGINS_DIR}/${old}"
  fi
done

echo "==> 卸载完成，请重启 DeepSeek Harness。"
