# 字面工房 — 一键发布（提交 + 推送，GitHub Pages 自动更新）
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\publish.ps1
#   第一次可以带仓库地址： -Remote https://github.com/用户名/仓库名.git
param(
  [string]$Remote = '',
  [string]$Message = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Find-Git {
  $cmd = Get-Command git -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $cands = @()
  $cands += Join-Path $env:LOCALAPPDATA 'dsh-portablegit\git\cmd\git.exe'
  $cands += Get-ChildItem "$env:LOCALAPPDATA\GitHubDesktop" -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'resources\app\git\cmd\git.exe' }
  $cands += 'C:\Program Files\Git\bin\git.exe'
  $cands += 'C:\Program Files (x86)\Git\bin\git.exe'
  foreach ($c in $cands) { if (Test-Path $c) { return $c } }
  return $null
}

$git = Find-Git
if (-not $git) {
  Write-Host ''
  Write-Host '  [x] 找不到 git。' -ForegroundColor Red
  Write-Host '      装一个 Git（https://git-scm.com/download/win），或者用 GitHub Desktop 点「Publish repository」。'
  Write-Host ''
  exit 1
}
# 便携版 git 可能不在系统 PATH 里：凭证助手（GCM）要靠 PATH 找到 git
$gitCmdDir = Split-Path $git -Parent
if ($env:PATH -notlike "*$gitCmdDir*") { $env:PATH = "$gitCmdDir;$env:PATH" }

function Run($args_) {
  # 原生命令的 stderr 在 PowerShell 5.1 里会被当成终止错误，这里临时放宽
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $out = & $git @args_ 2>&1
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  return @{ code = $code; out = $out }
}

if (-not (Test-Path (Join-Path $root '.git'))) {
  & $git init -b main | Out-Null
  & $git config core.autocrlf false
  Write-Host '  已初始化本地仓库（main 分支）'
}

# 远端
$r = Run @('remote', 'get-url', 'origin')
if ($r.code -ne 0) {
  if ($Remote -ne '') {
    & $git remote add origin $Remote
    Write-Host "  已设置远端：$Remote"
  } else {
    Write-Host ''
    Write-Host '  还没有远端仓库。二选一：' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '  A) 用 GitHub Desktop（最省事，推荐）'
    Write-Host '     1. 打开 GitHub Desktop → File → Add local repository → 选这个文件夹'
    Write-Host '     2. 右上角 Publish repository → 名字填 zimian-studio → 取消勾选 Keep this code private'
    Write-Host '     3. 发布完再双击一次「发布.cmd」，以后就都是自动的了'
    Write-Host ''
    Write-Host '  B) 已经有空仓库了，把地址记下来，双击「发布.cmd」时它会问你要（或手动执行）：'
    Write-Host '     git remote add origin https://github.com/你的用户名/zimian-studio.git'
    Write-Host ''
    exit 2
  }
}

# 静态资源版本号：每次发布换一个，免得浏览器 / CDN 拿旧缓存（index.html 里的 ?v=）
$idx = Join-Path $root 'index.html'
if (Test-Path $idx) {
  $stamp = Get-Date -Format 'yyyyMMddHHmm'
  $txt = [IO.File]::ReadAllText($idx, [Text.Encoding]::UTF8)
  $new = [regex]::Replace($txt, '\?v=[0-9A-Za-z]+', "?v=$stamp")
  if ($new -ne $txt) {
    [IO.File]::WriteAllText($idx, $new, (New-Object Text.UTF8Encoding($false)))
    Write-Host "  静态资源版本号 → $stamp"
  }
}

# 提交
& $git add -A | Out-Null
$st = Run @('status', '--porcelain')
if (($st.out | Measure-Object).Count -eq 0) {
  Write-Host '  没有改动，直接推送…'
} else {
  if ($Message -eq '') { $Message = 'update ' + (Get-Date -Format 'yyyy-MM-dd HH:mm') }
  & $git commit -m $Message | Out-Null
  Write-Host "  已提交：$Message"
}

# 推送（国内直连 github 常被重置：先直连，失败就自动找本机代理再试一次）
Write-Host '  正在推送到 GitHub…'
$p = Run @('push', '-u', 'origin', 'HEAD')

function Find-ProxyPort {
  foreach ($port in 7890, 7897, 10809, 1080, 8889) {
    $c = New-Object System.Net.Sockets.TcpClient
    try {
      $ar = $c.BeginConnect('127.0.0.1', $port, $null, $null)
      if ($ar.AsyncWaitHandle.WaitOne(250) -and $c.Connected) { $c.Close(); return $port }
    } catch { }
    finally { try { $c.Close() } catch { } }
  }
  return 0
}

if ($p.code -ne 0) {
  $proxyPort = Find-ProxyPort
  if ($proxyPort -gt 0) {
    Write-Host "  直连失败，改用本机代理 127.0.0.1:$proxyPort 重试…" -ForegroundColor Yellow
    $p = Run @('-c', "http.proxy=http://127.0.0.1:$proxyPort", '-c', 'http.version=HTTP/1.1', 'push', '-u', 'origin', 'HEAD')
  }
}

if ($p.code -ne 0) {
  $txt = ($p.out | Out-String)
  Write-Host ''
  if ($txt -match 'Authentication|credential|403|Permission denied|fatal: could not read') {
    Write-Host '  [x] 推送需要登录 GitHub（只第一次）。' -ForegroundColor Yellow
    Write-Host '      弹窗里用浏览器登录一次；成功之后这里会记住，不用再登。'
  } else {
    Write-Host '  [x] 推送失败：' -ForegroundColor Red
    Write-Host $txt
    Write-Host '      网络问题的常见解法：开着你平常的代理（Clash 等）再点一次；脚本会自动走 127.0.0.1:7890 重试。'
  }
  Write-Host ''
  exit 3
}

# 推断在线地址
$url = (& $git remote get-url origin)
if ($url -match 'github\.com[:/]([^/]+)/([^/.]+)') {
  $user = $Matches[1]; $repo = $Matches[2]
  Write-Host ''
  Write-Host '  已上线：' -ForegroundColor Green
  Write-Host "  https://$user.github.io/$repo/" -ForegroundColor Cyan
  Write-Host '  （GitHub Pages 一般 30~60 秒内生效；第一次用要先在仓库 Settings → Pages 里把 Source 设成 main / (root)）'
}
Write-Host ''
