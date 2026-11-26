@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title PaperPocket 纸间书架

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装 Node.js 后再启动。
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo 首次启动，正在安装依赖...
  call npm install
  if errorlevel 1 (
    echo [错误] 依赖安装失败。
    pause
    exit /b 1
  )
)

node -e "const fs=require('fs'),p=require('path');if(!fs.existsSync('dist/index.html'))process.exit(2);const dt=fs.statSync('dist/index.html').mtimeMs;const newer=d=>fs.existsSync(d)&&fs.readdirSync(d,{withFileTypes:true}).some(e=>{const f=p.join(d,e.name);return e.isDirectory()?newer(f):fs.statSync(f).mtimeMs>dt});if(newer('src')||newer('sound'))process.exit(2)"
if errorlevel 2 (
  echo 检测到代码或音效有更新，正在构建 PaperPocket...
  call npm run build
  if errorlevel 1 (
    echo [错误] 构建失败，请检查控制台输出。
    pause
    exit /b 1
  )
)

set "PORT=4173"
if not "%PAPERPOCKET_PORT%"=="" set "PORT=%PAPERPOCKET_PORT%"

node -e "const net=require('net'),s=net.connect(Number(process.argv[1]),'127.0.0.1');s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),500)" "%PORT%"
if not errorlevel 1 (
  echo PaperPocket 服务已在运行，正在为您打开浏览器...
  start "" "http://127.0.0.1:%PORT%"
  timeout /t 2 >nul
  exit /b 0
)

echo.
echo ==================================================
echo   PaperPocket 纸间书架
echo   访问地址: http://127.0.0.1:%PORT%
echo   提示: 保持此窗口开启即可阅读，关闭窗口即停止服务
echo ==================================================
echo.

set "PAPERPOCKET_PORT=%PORT%"
node start.mjs --open

if errorlevel 1 (
  echo.
  echo [错误] 服务异常退出。
  pause
)
