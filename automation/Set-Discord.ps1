$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -Global -ErrorAction Stop
$taskStore = Join-Path $env:LOCALAPPDATA 'DolphinData\automation'
New-Item -ItemType Directory -Path $taskStore -Force | Out-Null
$guildId = Read-Host '디스코드 서버 ID'
$channelId = Read-Host '리포트 및 승인 채널 ID'
$ownerId = Read-Host '승인할 본인 계정 ID'
foreach ($taskId in @($guildId, $channelId, $ownerId)) {
    if ($taskId -notmatch '^\d{17,22}$') { throw '디스코드 개발자 모드에서 ID를 복사해주세요.' }
}
$taskToken = Read-Host '봇 토큰 (화면에 표시되지 않음)' -AsSecureString
if ($taskToken.Length -eq 0) { throw '토큰이 비어 있습니다.' }
# DPAPI: only this Windows user on this PC can decrypt the saved token.
$protectedToken = ConvertFrom-SecureString -SecureString $taskToken
Set-Content -LiteralPath (Join-Path $taskStore 'discord-token.dpapi') -Value $protectedToken -Encoding UTF8
@{ guildId = $guildId; channelId = $channelId; ownerId = $ownerId } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskStore 'discord-config.json') -Encoding UTF8
Write-Host '디스코드 설정을 저장했습니다. Start-Automation.ps1을 실행해주세요.'
