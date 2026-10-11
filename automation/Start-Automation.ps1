$ErrorActionPreference = 'Stop'
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
    & node (Join-Path $PSScriptRoot 'server.mjs')
} finally { Remove-Item Env:\DOLPHIN_DISCORD_TOKEN -ErrorAction SilentlyContinue }
