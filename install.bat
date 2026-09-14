@echo off
chcp 65001 >nul
title 安装无限四代插件
echo.
echo ======================================================
echo    DeepSeek 网络安全红队工具「无限四代」安装向导
echo ======================================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
echo.
echo 按任意键退出...
pause >nul