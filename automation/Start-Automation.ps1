$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -Global -ErrorAction Stop
$taskStore = Join-Path $env:LOCALAPPDATA 'DolphinData\automation'
$taskTokenPath = Join-Path $taskStore 'discord-token.dpapi'
$codexCommand = Get-Command codex.exe -ErrorAction SilentlyContinue
if ($codexCommand) { $env:DOLPHIN_CODEX_PATH = $codexCommand.Source }
if (!(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules\discord.js'))) {
    Push-Location $PSScriptRoot
    try { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw '자동화 도구 설치에 실패했습니다.' } } finally { Pop-Location }
}
try {
    if (Test-Path -LiteralPath $taskTokenPath) {
        $secureTaskToken = Get-Content -LiteralPath $taskTokenPath -Raw | ConvertTo-SecureString
        $taskTokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureTaskToken)
        try { $env:DOLPHIN_DISCORD_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskTokenPointer) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskTokenPointer) }
    }
    $taskAdminOpened = $false
    & node (Join-Path $PSScriptRoot 'server.mjs') | ForEach-Object {
        $taskOutputLine = [string]$_
        Write-Output $taskOutputLine
        if (!$taskAdminOpened -and $env:DOLPHIN_OPEN_ADMIN -ne '0' -and $taskOutputLine -match 'http://127\.0\.0\.1:4174/#[a-f0-9]{64}') {
            $taskAdminOpened = $true
            Start-Process -FilePath $Matches[0]
        }
    }
} finally { Remove-Item Env:\DOLPHIN_DISCORD_TOKEN -ErrorAction SilentlyContinue }
