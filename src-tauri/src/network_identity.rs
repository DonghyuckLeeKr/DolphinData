use serde::{Deserialize, Serialize};
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NetworkIdentity {
    pub connected: bool,
    pub fingerprint: String,
    pub identity_kind: String,
    pub network_name: String,
    pub interface_name: String,
    pub interface_description: String,
    pub connection_type: String,
    pub gateway_ip: String,
}

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct WindowsNetworkSnapshot {
    connected: bool,
    network_name: Option<String>,
    interface_name: Option<String>,
    interface_description: Option<String>,
    connection_type: Option<String>,
    gateway_ip: Option<String>,
    gateway_mac: Option<String>,
    adapter_mac: Option<String>,
    pnp_device_id: Option<String>,
}

fn normalize_component(value: Option<String>) -> String {
    value.unwrap_or_default().trim().to_lowercase()
}

fn normalize_mac(value: Option<String>) -> String {
    normalize_component(value)
        .chars()
        .filter(|character| character.is_ascii_hexdigit())
        .collect()
}

fn stable_fingerprint(source: &str) -> String {
    // FNV-1a is intentionally used instead of DefaultHasher so persisted IDs
    // remain stable across application and Rust upgrades.
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in source.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("network-v1-{hash:016x}")
}

fn is_transient_name(name: &str) -> bool {
    let lower = name.trim().to_lowercase();
    lower.is_empty()
        || lower.contains("식별 중")
        || lower.contains("identifying")
        || lower == "unknown"
}

fn is_generic_network_name(name: &str) -> bool {
    let lower = name.trim().to_lowercase();
    if lower == "네트워크" || lower == "network" {
        return true;
    }
    if let Some(rest) = lower.strip_prefix("네트워크 ") {
        return rest.chars().all(|c| c.is_ascii_digit());
    }
    if let Some(rest) = lower.strip_prefix("network ") {
        return rest.chars().all(|c| c.is_ascii_digit());
    }
    false
}

fn build_identity(snapshot: WindowsNetworkSnapshot) -> NetworkIdentity {
    if !snapshot.connected {
        return NetworkIdentity::default();
    }

    let network_name = snapshot.network_name.unwrap_or_default().trim().to_string();
    if is_transient_name(&network_name) {
        return NetworkIdentity::default();
    }

    let interface_name = snapshot
        .interface_name
        .unwrap_or_default()
        .trim()
        .to_string();
    let interface_description = snapshot
        .interface_description
        .unwrap_or_default()
        .trim()
        .to_string();
    let connection_type = snapshot
        .connection_type
        .unwrap_or_default()
        .trim()
        .to_string();
    let gateway_ip = snapshot.gateway_ip.unwrap_or_default().trim().to_string();
    let gateway_mac = normalize_mac(snapshot.gateway_mac);
    let adapter_mac = normalize_mac(snapshot.adapter_mac);
    let pnp_device_id = normalize_component(snapshot.pnp_device_id);
    let normalized_network_name = network_name.to_lowercase();

    // USB router gateway MACs can rotate on every reconnect. Windows keeps the
    // USB device's PnP ID stable when the same device is reconnected.
    // The raw PnP ID is only used to derive the local fingerprint.
    let (identity_kind, source) = if pnp_device_id.starts_with("usb\\") && !gateway_ip.is_empty() {
        (
            "usb-device",
            format!("usb-device:{pnp_device_id}:{gateway_ip}"),
        )
    } else if gateway_mac.len() == 12 {
        ("gateway-mac", format!("gateway-mac:{gateway_mac}"))
    } else if !is_generic_network_name(&normalized_network_name)
        && !normalized_network_name.is_empty()
    {
        (
            "network-name",
            format!("network-name:{normalized_network_name}"),
        )
    } else if adapter_mac.len() == 12 && !gateway_ip.is_empty() {
        (
            "adapter-gateway",
            format!("adapter-gateway:{adapter_mac}:{gateway_ip}"),
        )
    } else if adapter_mac.len() == 12 {
        ("adapter-mac", format!("adapter-mac:{adapter_mac}"))
    } else if !normalized_network_name.is_empty() {
        (
            "network-name",
            format!("network-name:{normalized_network_name}"),
        )
    } else {
        return NetworkIdentity::default();
    };

    NetworkIdentity {
        connected: true,
        fingerprint: stable_fingerprint(&source),
        identity_kind: identity_kind.to_string(),
        network_name,
        interface_name,
        interface_description,
        connection_type,
        gateway_ip,
    }
}

#[cfg(target_os = "windows")]
pub fn detect_current_network_identity() -> Result<NetworkIdentity, String> {
    // Prefer a physical adapter with Internet connectivity. The gateway MAC is
    // a stronger router/hotspot identity than the PC's adapter GUID or SSID.
    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$candidates = @()
foreach ($profile in @(Get-NetConnectionProfile)) {
  $adapter = Get-NetAdapter -InterfaceIndex $profile.InterfaceIndex -ErrorAction SilentlyContinue
  if ($null -ne $adapter -and $adapter.Status -eq 'Up' -and $adapter.HardwareInterface -and
      ($profile.IPv4Connectivity -eq 'Internet' -or $profile.IPv6Connectivity -eq 'Internet')) {
    $rank = if ($profile.IPv4Connectivity -eq 'Internet') { 0 } elseif ($profile.IPv6Connectivity -eq 'Internet') { 1 } else { 2 }
    $candidates += [pscustomobject]@{ Profile = $profile; Adapter = $adapter; Rank = $rank }
  }
}
$selected = $candidates | Sort-Object Rank, @{Expression = { $_.Profile.InterfaceIndex }} | Select-Object -First 1
if ($null -eq $selected) {
  [pscustomobject]@{ connected = $false } | ConvertTo-Json -Compress
  exit 0
}
$profile = $selected.Profile
$adapter = $selected.Adapter
$ipConfig = Get-NetIPConfiguration -InterfaceIndex $profile.InterfaceIndex -ErrorAction SilentlyContinue
$gateway = @($ipConfig.IPv4DefaultGateway | Select-Object -ExpandProperty NextHop -ErrorAction SilentlyContinue)[0]
$gatewayMac = ''
if ($gateway) {
  $neighbor = Get-NetNeighbor -InterfaceIndex $profile.InterfaceIndex -IPAddress $gateway -ErrorAction SilentlyContinue | Where-Object { $_.State -ne 'Incomplete' -and $_.LinkLayerAddress -ne '' } | Select-Object -First 1
  if ($null -eq $neighbor) {
    Test-Connection -TargetName $gateway -Count 1 -TimeoutSeconds 1 -Quiet -ErrorAction SilentlyContinue | Out-Null
    $neighbor = Get-NetNeighbor -InterfaceIndex $profile.InterfaceIndex -IPAddress $gateway -ErrorAction SilentlyContinue | Where-Object { $_.State -ne 'Incomplete' -and $_.LinkLayerAddress -ne '' } | Select-Object -First 1
  }
  if ($null -ne $neighbor) { $gatewayMac = [string]$neighbor.LinkLayerAddress }
}
[pscustomobject]@{
  connected = $true
  networkName = [string]$profile.Name
  interfaceName = [string]$profile.InterfaceAlias
  interfaceDescription = [string]$adapter.InterfaceDescription
  connectionType = [string]$adapter.MediaType
  gatewayIp = [string]$gateway
  gatewayMac = $gatewayMac
  adapterMac = [string]$adapter.MacAddress
  pnpDeviceId = [string]$adapter.PnPDeviceID
} | ConvertTo-Json -Compress
"#;

    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| format!("Windows 네트워크 정보를 읽지 못했습니다: {error}"))?;

    if !output.status.success() {
        return Err("Windows 네트워크 정보를 읽지 못했습니다.".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let snapshot: WindowsNetworkSnapshot = serde_json::from_str(stdout.trim())
        .map_err(|error| format!("Windows 네트워크 정보 형식이 올바르지 않습니다: {error}"))?;
    Ok(build_identity(snapshot))
}

#[cfg(not(target_os = "windows"))]
pub fn detect_current_network_identity() -> Result<NetworkIdentity, String> {
    Ok(NetworkIdentity::default())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(gateway_mac: &str, network_name: &str) -> WindowsNetworkSnapshot {
        WindowsNetworkSnapshot {
            connected: true,
            network_name: Some(network_name.to_string()),
            interface_name: Some("Wi-Fi".to_string()),
            interface_description: Some("Wireless Adapter".to_string()),
            connection_type: Some("Native 802.11".to_string()),
            gateway_ip: Some("192.168.219.1".to_string()),
            gateway_mac: Some(gateway_mac.to_string()),
            adapter_mac: None,
            pnp_device_id: None,
        }
    }

    #[test]
    fn gateway_mac_is_stable_across_format_and_network_name_changes() {
        let first = build_identity(snapshot("AA-BB-CC-DD-EE-FF", "Hotspot B"));
        let second = build_identity(snapshot("aa:bb:cc:dd:ee:ff", "Renamed hotspot"));

        assert_eq!(first.fingerprint, second.fingerprint);
        assert_eq!(first.identity_kind, "gateway-mac");
        assert_eq!(first.gateway_ip, "192.168.219.1");
    }

    #[test]
    fn different_gateways_create_different_network_fingerprints() {
        let first = build_identity(snapshot("AA-BB-CC-DD-EE-01", "Hotspot"));
        let second = build_identity(snapshot("AA-BB-CC-DD-EE-02", "Hotspot"));

        assert_ne!(first.fingerprint, second.fingerprint);
    }

    #[test]
    fn usb_router_keeps_its_identity_when_windows_name_and_gateway_mac_change() {
        let mut first = snapshot("5C-E8-D3-0E-1F-75", "네트워크 75");
        first.gateway_ip = Some("192.168.0.1".to_string());
        first.pnp_device_id = Some("USB\\VID_19D2&PID_1557&MI_00\\7&23391696&0&0000".to_string());
        let mut second = snapshot("32-29-5F-C9-19-F2", "네트워크 76");
        second.gateway_ip = Some("192.168.0.1".to_string());
        second.pnp_device_id = Some("usb\\vid_19d2&pid_1557&mi_00\\7&23391696&0&0000".to_string());

        let before = build_identity(first);
        let after = build_identity(second);
        assert_eq!(before.identity_kind, "usb-device");
        assert_eq!(before.fingerprint, after.fingerprint);
    }

    #[test]
    fn different_usb_devices_have_different_fingerprints() {
        let mut first = snapshot("", "네트워크 75");
        first.pnp_device_id = Some("USB\\VID_19D2&PID_1557\\DEVICE_A".to_string());
        let mut second = snapshot("", "네트워크 76");
        second.pnp_device_id = Some("USB\\VID_19D2&PID_1557\\DEVICE_B".to_string());

        assert_ne!(
            build_identity(first).fingerprint,
            build_identity(second).fingerprint
        );
    }

    #[test]
    fn network_name_is_a_fallback_when_gateway_mac_is_unavailable() {
        let identity = build_identity(snapshot("", "My Phone"));

        assert!(identity.connected);
        assert_eq!(identity.identity_kind, "network-name");
        assert!(!identity.fingerprint.is_empty());
    }

    #[test]
    fn transient_identifying_states_are_ignored() {
        let identifying_kr = snapshot("", "식별 중...");
        let identifying_en = snapshot("", "identifying...");

        assert!(!build_identity(identifying_kr).connected);
        assert!(!build_identity(identifying_en).connected);
    }

    #[test]
    fn generic_network_name_falls_back_to_adapter_mac_and_gateway() {
        let mut snap1 = snapshot("", "네트워크 74");
        snap1.adapter_mac = Some("34-4B-50-00-00-00".to_string());
        snap1.gateway_ip = Some("192.168.0.1".to_string());

        let mut snap2 = snapshot("", "네트워크 75");
        snap2.adapter_mac = Some("34-4b-50-00-00-00".to_string());
        snap2.gateway_ip = Some("192.168.0.1".to_string());

        let first = build_identity(snap1);
        let second = build_identity(snap2);

        assert!(first.connected);
        assert!(second.connected);
        assert_eq!(first.identity_kind, "adapter-gateway");
        assert_eq!(first.fingerprint, second.fingerprint);
    }
}
