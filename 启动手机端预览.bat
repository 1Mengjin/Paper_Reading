@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0mobile-android"
title PaperPocket Android 手机端预览

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装 Node.js。
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo 首次启动，正在安装手机端依赖...
  call npm install
  if errorlevel 1 (
    echo [错误] 依赖安装失败。
    pause
    exit /b 1
  )
)

echo.
echo ==================================================
echo   PaperPocket Android 手机端本地预览
echo   访问地址: http://127.0.0.1:4174
echo   提示: 建议在浏览器按 F12 切换手机竖屏模式体验
echo ==================================================
echo.
start "" "http://127.0.0.1:4174"
call npm run dev
