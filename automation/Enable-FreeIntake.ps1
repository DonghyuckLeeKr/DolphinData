$ErrorActionPreference = 'Stop'
$intakeStore = Join-Path $env:LOCALAPPDATA 'DolphinData\automation'
$intakeTools = Join-Path $intakeStore 'tools'
New-Item -ItemType Directory -Path $intakeTools -Force | Out-Null
$intakeRelease = Invoke-RestMethod -Uri 'https://api.github.com/repos/cloudflare/cloudflared/releases/latest'
$intakeAsset = @($intakeRelease.assets | Where-Object { $_.name -eq 'cloudflared-windows-amd64.exe' })[0]
if (!$intakeAsset -or $intakeAsset.digest -notmatch '^sha256:[a-f0-9]{64}$') { throw '공식 연결 도구의 검증 정보를 찾지 못했습니다.' }
$intakeDestination = Join-Path $intakeTools 'cloudflared.exe'
Invoke-WebRequest -Uri $intakeAsset.browser_download_url -OutFile "$intakeDestination.download"
$intakeExpectedHash = $intakeAsset.digest.Substring(7)
if ((Get-FileHash -LiteralPath "$intakeDestination.download" -Algorithm SHA256).Hash.ToLowerInvariant() -ne $intakeExpectedHash) { throw '연결 도구 파일 검증에 실패했습니다.' }
Move-Item -LiteralPath "$intakeDestination.download" -Destination $intakeDestination -Force
[IO.File]::WriteAllText((Join-Path $intakeStore 'free-intake.json'), '{"enabled":true}', [Text.UTF8Encoding]::new($false))
Write-Host '무료 외부 접수 연결 도구를 검증하고 준비했습니다. Start-Automation.cmd를 다시 실행해주세요.'
