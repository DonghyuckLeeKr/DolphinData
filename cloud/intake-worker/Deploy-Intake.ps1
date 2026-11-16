$ErrorActionPreference = 'Stop'
# One-time setup of the Cloudflare intake. Secrets are generated here, sent straight to
# Cloudflare and to this PC's DPAPI store, and never printed or written to the repository.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -Global -ErrorAction Stop
Set-Location -LiteralPath $PSScriptRoot
$wranglerVersion = 'wrangler@4.52.0'
$databaseName = 'dolphindata-intake'

function Read-Secret([string]$prompt) {
    $secure = Read-Host $prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function New-RandomHex([int]$bytes) {
    $buffer = New-Object byte[] $bytes
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
    return -join ($buffer | ForEach-Object { $_.ToString('x2') })
}

# Runs wrangler and returns its combined output; secret values are only ever passed on stdin.
function Invoke-Wrangler([string[]]$arguments, [string]$stdin = $null) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        if ($null -ne $stdin) { $output = $stdin | & npx.cmd --yes $wranglerVersion @arguments 2>&1 | Out-String }
        else { $output = & npx.cmd --yes $wranglerVersion @arguments 2>&1 | Out-String }
        if ($LASTEXITCODE -ne 0) { throw "wrangler $($arguments[0]) 실패:`n$output" }
        return $output
    } finally { $ErrorActionPreference = $previous }
}

try {
    $env:CLOUDFLARE_API_TOKEN = Read-Secret 'Cloudflare API 토큰 (화면에 표시되지 않음)'
    if ($env:CLOUDFLARE_API_TOKEN.Length -lt 20) { throw 'Cloudflare API 토큰을 확인해주세요.' }
    $accountId = (Read-Host 'Cloudflare 계정 ID (계정이 하나면 Enter)').Trim()
    if ($accountId) {
        if ($accountId -notmatch '^[a-f0-9]{32}$') { throw '계정 ID는 32자리 16진수입니다.' }
        $env:CLOUDFLARE_ACCOUNT_ID = $accountId
    }

    Write-Host '1/5 D1 데이터베이스 확인 중...'
    $databases = Invoke-Wrangler @('d1', 'list', '--json') | ConvertFrom-Json
    $database = @($databases | Where-Object { $_.name -eq $databaseName })[0]
    if (!$database) {
        Invoke-Wrangler @('d1', 'create', $databaseName) | Out-Null
        $database = @((Invoke-Wrangler @('d1', 'list', '--json') | ConvertFrom-Json) | Where-Object { $_.name -eq $databaseName })[0]
    }
    if (!$database.uuid) { throw 'D1 데이터베이스 ID를 확인하지 못했습니다.' }
    $config = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'wrangler.toml'))
    $config = $config -replace 'database_id = "[^"]*"', "database_id = `"$($database.uuid)`""
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'wrangler.toml'), $config, [Text.UTF8Encoding]::new($false))

    Write-Host '2/5 테이블 준비 중...'
    Invoke-Wrangler @('d1', 'execute', $databaseName, '--remote', '--file=schema.sql') | Out-Null

    Write-Host '3/5 Worker 배포 중...'
    $deployOutput = Invoke-Wrangler @('deploy')
    if ($deployOutput -notmatch 'https://[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev') { throw "배포 주소를 찾지 못했습니다:`n$deployOutput" }
    $endpoint = $Matches[0]

    Write-Host '4/5 비밀값 설정 중...'
    $adminToken = New-RandomHex 32
    Invoke-Wrangler @('secret', 'put', 'ADMIN_TOKEN') $adminToken | Out-Null
    Invoke-Wrangler @('secret', 'put', 'RATE_SALT') (New-RandomHex 32) | Out-Null
    $webhook = Read-Secret '디스코드 알림 웹후크 URL (선택, 없으면 Enter)'
    if ($webhook) {
        if ($webhook -notmatch '^https://(discord\.com|discordapp\.com)/api/webhooks/') { throw '디스코드 웹후크 주소를 확인해주세요.' }
        Invoke-Wrangler @('secret', 'put', 'DISCORD_WEBHOOK_URL') $webhook | Out-Null
    }

    Write-Host '5/5 이 PC의 자동화에 연결 정보 저장 중...'
    $store = Join-Path $env:LOCALAPPDATA 'DolphinData\automation'
    New-Item -ItemType Directory -Path $store -Force | Out-Null
    $protected = ConvertTo-SecureString -String $adminToken -AsPlainText -Force | ConvertFrom-SecureString
    # No BOM or trailing newline: ConvertTo-SecureString rejects both when reading it back.
    [IO.File]::WriteAllText((Join-Path $store 'cloud-intake-token.dpapi'), $protected, [Text.UTF8Encoding]::new($false))
    @{ endpoint = $endpoint } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $store 'cloud-intake.json') -Encoding UTF8
    $adminToken = $null

    $status = Invoke-RestMethod -Uri "$endpoint/v1/status" -TimeoutSec 20
    if ($status.service -ne 'DolphinData diagnostic intake') { throw '배포한 Worker의 응답을 확인하지 못했습니다.' }
    Write-Host ''
    Write-Host "완료. 접수 주소: $endpoint"
} finally {
    Remove-Item Env:\CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:\CLOUDFLARE_ACCOUNT_ID -ErrorAction SilentlyContinue
}
