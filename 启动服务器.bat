@echo off
title 装修项目管家 - 同步服务器
cd /d "%~dp0"
echo.
echo ========================================
echo   装修项目管家 - 局域网同步服务器
echo ========================================
echo.
echo 正在启动服务器...
echo.
start http://localhost:3456
node server.js
pause
