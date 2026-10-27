@echo off
title 发布到网上
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\publish.ps1" %*
echo.
pause