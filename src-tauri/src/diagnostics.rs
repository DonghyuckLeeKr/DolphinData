use serde::{Deserialize, Serialize};

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticDriver {
    pub vendor_id: String,
    pub product_id: String,
    pub version: String,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticEnvironment {
    pub os_version: String,
    pub architecture: String,
    pub usb_network_drivers: Vec<DiagnosticDriver>,
}

// Explicitly requested when starting a report. No device serial, SIM number,
// account, adapter name, IP address or full PnP identifier is returned.
#[cfg(target_os = "windows")]
pub fn collect_diagnostic_environment() -> Result<DiagnosticEnvironment, String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    let script = r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$os = Get-CimInstance Win32_OperatingSystem
$drivers = @()
foreach ($driver in @(Get-CimInstance Win32_PnPSignedDriver -Filter "DeviceClass = 'NET'")) {
  if ([string]$driver.DeviceID -match '^USB\\VID_([0-9A-Fa-f]{4})&PID_([0-9A-Fa-f]{4})') {
    $vendor = $Matches[1].ToLower()
    $product = $Matches[2].ToLower()
    $version = [string]$driver.DriverVersion
    if ($version -match '^\d{1,10}(\.\d{1,10}){1,4}$') {
      $drivers += [pscustomobject]@{ vendorId = $vendor; productId = $product; version = $version }
    }
  }
}
[pscustomobject]@{ osVersion = [string]$os.Version; architecture = ''; usbNetworkDrivers = @($drivers | Select-Object -First 8) } | ConvertTo-Json -Depth 4 -Compress
"#;
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(0x08000000)
        .output()
        .map_err(|_| "Windows 진단 환경 정보를 읽지 못했습니다.".to_string())?;
    if !output.status.success() {
        return Err("Windows 진단 환경 정보를 읽지 못했습니다.".to_string());
    }
    let mut environment: DiagnosticEnvironment =
        serde_json::from_slice(&output.stdout).map_err(|_| "진단 환경 형식 오류".to_string())?;
    environment.architecture = std::env::consts::ARCH.to_string();
    Ok(environment)
}

#[cfg(not(target_os = "windows"))]
pub fn collect_diagnostic_environment() -> Result<DiagnosticEnvironment, String> {
    Ok(DiagnosticEnvironment::default())
}
