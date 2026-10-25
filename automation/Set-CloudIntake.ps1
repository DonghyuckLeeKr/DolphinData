$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -Global -ErrorAction Stop
$cloudStore = Join-Path $env:LOCALAPPDATA 'DolphinData\automation'
New-Item -ItemType Directory -Path $cloudStore -Force | Out-Null
$cloudEndpoint = (Read-Host '클라우드 접수 주소 (예: https://dolphindata-intake.이름.workers.dev)').Trim().TrimEnd('/')
if ($cloudEndpoint -notmatch '^https://[a-z0-9.-]+$') { throw 'https:// 로 시작하는 주소만 입력해주세요. 경로는 붙이지 않습니다.' }
$cloudToken = Read-Host '클라우드 접수 관리자 토큰 (화면에 표시되지 않음)' -AsSecureString
if ($cloudToken.Length -lt 32) { throw 'Worker에 설정한 ADMIN_TOKEN을 그대로 입력해주세요.' }
# DPAPI: only this Windows user on this PC can decrypt the saved token.
Set-Content -LiteralPath (Join-Path $cloudStore 'cloud-intake-token.dpapi') -Value (ConvertFrom-SecureString -SecureString $cloudToken) -Encoding UTF8
@{ endpoint = $cloudEndpoint } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $cloudStore 'cloud-intake.json') -Encoding UTF8
Write-Host '클라우드 접수 설정을 저장했습니다. Start-Automation.cmd를 다시 실행해주세요.'
