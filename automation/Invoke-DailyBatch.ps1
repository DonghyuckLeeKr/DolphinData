param([switch]$PreviewOnly, [switch]$StatusOnly)
$ErrorActionPreference = 'Stop'
try {
    Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -Global -ErrorAction Stop
    $taskAccessPath = Join-Path $env:LOCALAPPDATA 'DolphinData\automation\admin-access.dpapi'
    if (!(Test-Path -LiteralPath $taskAccessPath)) { throw 'Start-Automation.cmd를 먼저 실행해주세요.' }
    $taskSecureAccess = Get-Content -LiteralPath $taskAccessPath -Raw | ConvertTo-SecureString
    $taskAccessPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecureAccess)
    try { $taskAddress = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskAccessPointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskAccessPointer) }
    if ($taskAddress -notmatch '^http://127\.0\.0\.1:4174/#[a-f0-9]{64}$') { throw '관리자 연결 설정을 확인해주세요.' }
    $taskAuth = @{ Authorization = "Bearer $($taskAddress.Split('#')[1])" }
    $taskAddress = $null
    if ($StatusOnly) {
        $taskResult = Invoke-RestMethod -Uri 'http://127.0.0.1:4174/api/daily-status' -Headers $taskAuth -TimeoutSec 30
    } else {
        $taskInput = @{ previewOnly = [bool]$PreviewOnly } | ConvertTo-Json -Compress
        $taskResult = Invoke-RestMethod -Uri 'http://127.0.0.1:4174/api/daily-run' -Method Post -Headers $taskAuth -ContentType 'application/json' -Body $taskInput -TimeoutSec 30
    }
    $taskAuth = $null
    # This endpoint contains only schedule/job metadata, never credentials or report text.
    $taskResult | ConvertTo-Json -Depth 10
} catch {
    $taskAuth = $null
    Write-Output '{"state":"unavailable","error":"일일 자동 수정에 연결하지 못했습니다. Start-Automation.cmd와 디스코드 연결을 확인해주세요."}'
    exit 1
}
