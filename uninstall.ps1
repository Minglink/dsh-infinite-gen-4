<#
============================================================================
  dsh-infinite-gen-4  ·  DeepSeek 网络安全红队工具「无限四代」一键卸载脚本
============================================================================
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$pluginName     = 'dsh-infinite-gen-4'
$pluginLabel    = '无限四代'
$allGenPlugins  = @('dsh-infinite-gen-4', 'dsh-infinite-gen-3', 'dsh-infinite-gen-1', 'dsh-infinite-gen-2', '无限四代', '无限三代', '无限二代', '无限一代')

function Write-Step { param([string]$Msg) Write-Host "`n==> $Msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Msg) Write-Host "    [OK] $Msg" -ForegroundColor Green }

$dshRoot     = Join-Path $env:USERPROFILE '.dsh'
$pluginsDir  = Join-Path $dshRoot 'plugins'

Write-Step '查找 profile 配置'
$dirs = @('web', 'default', 'desktop') | ForEach-Object { Join-Path (Join-Path $dshRoot 'profiles') $_ } | Where-Object { Test-Path (Join-Path $_ 'package.json') }

foreach ($pDir in $dirs) {
    $pName = Split-Path $pDir -Leaf
    $pkgPath = Join-Path $pDir 'package.json'
    $pkg = Get-Content -LiteralPath $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $changed = $false
    foreach ($p in $allGenPlugins) {
        if ($pkg.dependencies -and $pkg.dependencies.PSObject.Properties.Name -contains $p) {
            $pkg.dependencies.PSObject.Properties.Remove($p)
            $changed = $true
        }
        if ($pkg.dsh -and $pkg.dsh.profile -and $pkg.dsh.profile.bundles -contains $p) {
            $pkg.dsh.profile.bundles = @($pkg.dsh.profile.bundles | Where-Object { $_ -ne $p })
            $changed = $true
        }
    }
    if ($changed) {
        $json = $pkg | ConvertTo-Json -Depth 10
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($pkgPath, $json + [Environment]::NewLine, $utf8NoBom)
        Write-Ok "[$pName] 已从 package.json 移除插件配置"
    }

    # 清理 cordis.patch.yml
    $patchPath = Join-Path $pDir 'cordis.patch.yml'
    if (Test-Path $patchPath) {
        $patchContent = [System.IO.File]::ReadAllText($patchPath, [System.Text.Encoding]::UTF8)
        $cleanedPatch = $patchContent
        foreach ($old in $allGenPlugins) {
            $cleanedPatch = $cleanedPatch -replace "(?m)^\s*-\s*insert:\s*\r?\n\s*-\s*id:\s*$old[\s\S]*?(?=(^\s*-\s*insert:|\z))", ""
        }
        $cleanedPatch = $cleanedPatch.Trim()
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($patchPath, $cleanedPatch + [Environment]::NewLine, $utf8NoBom)
        Write-Ok "[$pName] 已从 cordis.patch.yml 移除插件挂载"
    }

    # 清除 node_modules 中的软链/拷贝
    foreach ($old in $allGenPlugins) {
        $nmEntry = Join-Path $pDir "node_modules\$old"
        if (Test-Path $nmEntry) {
            try {
                if ((Get-Item $nmEntry).LinkType -eq 'Junction') {
                    cmd.exe /c "rmdir `"$nmEntry`"" 2>$null | Out-Null
                } else {
                    Remove-Item -LiteralPath $nmEntry -Recurse -Force
                }
            } catch {
                Remove-Item -LiteralPath $nmEntry -Recurse -Force -ErrorAction SilentlyContinue
            }
            Write-Ok "[$pName] 已清理 node_modules\$old"
        }
    }

    if ($changed) {
        Push-Location $pDir
        try { pnpm install | Out-Null } catch {} finally { Pop-Location }
    }
}

foreach ($p in $allGenPlugins) {
    $tDir = Join-Path $pluginsDir $p
    if (Test-Path $tDir) {
        Remove-Item -LiteralPath $tDir -Recurse -Force
        Write-Ok "已删除插件目录：$p"
    }
}

Write-Ok "卸载完成，请重启 DeepSeek Harness。"
