@echo off
chcp 65001 >nul
title PM Sync Server
cd /d "%~dp0"
echo.
echo ========================================
echo   PM Sync - LAN Sync Server
echo ========================================
echo.
echo Starting server...
echo.
start http://localhost:3456
node server.js
pause
