@echo off
title 字面工房 STUDIO  -  本机预览 :8099
cd /d "%~dp0dist\site"
if not exist "index.html" (
  echo.
  echo   [x] 找不到 dist\site ，先打包：node tools\build_publish.mjs
  echo.
  pause
  exit /b 1
)

for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object { $_.IPAddress -notmatch '^127\.' -and $_.IPAddress -notmatch '^169\.254' } ^| Select-Object -First 1).IPAddress"`) do set "LANIP=%%i"

echo.
echo   字面工房 STUDIO  ——  本机服务器
echo   ------------------------------------------------------------
echo   本机：    http://127.0.0.1:8099/
if defined LANIP echo   局域网：  http://%LANIP%:8099/     （同一网络的人都能打开）
echo.
echo   这个窗口关掉，服务就停了。
echo   注意：局域网是 http，能编辑、能预览，但不能导出视频。
echo         要导出请双击 dist\字面工房.html（本地文件是允许导出的）。
echo   ------------------------------------------------------------
echo.

start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:8099/'"

where python >nul 2>nul
if not errorlevel 1 (
  python -m http.server 8099 --bind 0.0.0.0
  goto done
)
where py >nul 2>nul
if not errorlevel 1 (
  py -3 -m http.server 8099 --bind 0.0.0.0
  goto done
)
echo   [x] 没找到 Python。装一个 Python 3，或者直接用 dist\字面工房.html 发文件。

:done
echo.
echo   服务已停止。
pause