// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use data_usage_counter::diagnostics::{collect_diagnostic_environment, DiagnosticEnvironment};
use data_usage_counter::network_identity::{detect_current_network_identity, NetworkIdentity};
use data_usage_counter::ping::{is_valid_ping_host, parse_ping_ms};
use data_usage_counter::process_network::ProcessNetworkMonitor;
use data_usage_counter::telemetry::{NetworkSampler, TelemetryData};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use sysinfo::{Pid, System};
use tauri::{
    CustomMenuItem, LogicalSize, Manager, State, SystemTray, SystemTrayEvent, SystemTrayMenu,
    SystemTrayMenuItem, WindowEvent,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, ERROR_CANCELLED, WAIT_OBJECT_0},
    Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY},
    System::Threading::{
        CreateEventW, CreateMutexW, GetCurrentProcess, OpenProcessToken, SetEvent,
        WaitForSingleObject, INFINITE,
    },
    UI::Shell::{ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW},
};

const CREATE_NO_WINDOW: u32 = 0x08000000;

#[tauri::command]
async fn get_diagnostic_intake(
) -> Result<data_usage_counter::diagnostic_intake::IntakeTarget, String> {
    data_usage_counter::diagnostic_intake::target().await
}

#[tauri::command]
async fn submit_diagnostic_report(
    report: serde_json::Value,
) -> Result<data_usage_counter::diagnostic_intake::DiagnosticReceipt, String> {
    data_usage_counter::diagnostic_intake::submit(report).await
}

#[tauri::command]
async fn get_diagnostic_environment() -> Result<DiagnosticEnvironment, String> {
    tauri::async_runtime::spawn_blocking(collect_diagnostic_environment)
        .await
        .map_err(|_| "진단 환경 수집 작업이 중단되었습니다.".to_string())?
}

#[cfg(target_os = "windows")]
const INSTANCE_MUTEX_NAME: &str = "Local\\DolphinData.com.datausage.counter.instance";

#[cfg(target_os = "windows")]
const INSTANCE_EVENT_NAME: &str = "Local\\DolphinData.com.datausage.counter.show";

#[cfg(target_os = "windows")]
const ELEVATED_RELAUNCH_ARG: &str = "--dolphindata-elevated-relaunch";

#[cfg(target_os = "windows")]
struct SingleInstanceGuard {
    mutex: isize,
    event: isize,
}

#[cfg(target_os = "windows")]
impl Drop for SingleInstanceGuard {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.event);
            CloseHandle(self.mutex);
        }
    }
}

#[cfg(target_os = "windows")]
fn wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn acquire_single_instance(elevated_relaunch: bool) -> Result<Option<SingleInstanceGuard>, String> {
    let mutex_name = wide_null(INSTANCE_MUTEX_NAME);
    let event_name = wide_null(INSTANCE_EVENT_NAME);
    for attempt in 0..100 {
        unsafe {
            let mutex = CreateMutexW(std::ptr::null(), 0, mutex_name.as_ptr());
            if mutex == 0 {
                return Err("앱 단일 실행 잠금을 만들지 못했습니다.".to_string());
            }
            let already_running = GetLastError() == ERROR_ALREADY_EXISTS;
            if already_running && elevated_relaunch {
                CloseHandle(mutex);
                if attempt == 99 {
                    return Err(
                        "기존 앱이 종료되지 않아 관리자 권한으로 다시 열지 못했습니다.".to_string(),
                    );
                }
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }
            let event = CreateEventW(std::ptr::null(), 0, 0, event_name.as_ptr());
            if event == 0 {
                CloseHandle(mutex);
                return Err("기존 앱 창 복원 신호를 만들지 못했습니다.".to_string());
            }
            if already_running {
                let _ = SetEvent(event);
                CloseHandle(event);
                CloseHandle(mutex);
                return Ok(None);
            }
            return Ok(Some(SingleInstanceGuard { mutex, event }));
        }
    }
    unreachable!()
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn is_running_as_admin() -> Result<bool, String> {
    unsafe {
        let mut token = 0;
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return Err(format!(
                "관리자 권한 확인에 실패했습니다: {}",
                GetLastError()
            ));
        }
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut returned = 0;
        let result = GetTokenInformation(
            token,
            TokenElevation,
            &mut elevation as *mut _ as *mut _,
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut returned,
        );
        let error = GetLastError();
        CloseHandle(token);
        if result == 0 {
            return Err(format!("관리자 권한 확인에 실패했습니다: {error}"));
        }
        Ok(elevation.TokenIsElevated != 0)
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn relaunch_as_admin() -> Result<(), String> {
    if is_running_as_admin()? {
        return Ok(());
    }
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let exe = wide_null(&exe.to_string_lossy());
    let verb = wide_null("runas");
    let parameters = wide_null(ELEVATED_RELAUNCH_ARG);
    let mut launch: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    launch.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    launch.fMask = SEE_MASK_NOASYNC | SEE_MASK_NOCLOSEPROCESS;
    launch.lpVerb = verb.as_ptr();
    launch.lpFile = exe.as_ptr();
    launch.lpParameters = parameters.as_ptr();
    launch.nShow = 1;
    unsafe {
        if ShellExecuteExW(&mut launch) == 0 {
            let error = GetLastError();
            return Err(if error == ERROR_CANCELLED {
                "관리자 권한 요청이 취소되었습니다. 현재 앱은 계속 실행됩니다.".to_string()
            } else {
                format!("관리자 권한으로 앱을 열지 못했습니다. Windows 오류: {error}")
            });
        }
        if launch.hProcess != 0 {
            CloseHandle(launch.hProcess);
        }
    }
    // The new process waits for this process to release its single-instance mutex.
    std::process::exit(0);
}

#[cfg(target_os = "windows")]
fn listen_for_relaunch(app: tauri::AppHandle, event: isize) {
    std::thread::spawn(move || loop {
        let wait_result = unsafe { WaitForSingleObject(event, INFINITE) };
        if wait_result != WAIT_OBJECT_0 {
            break;
        }
        if let Some(window) = app.get_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    });
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProcessActivityInfo {
    pub pid: u32,
    pub name: String,
    pub download_bytes_per_sec: u64,
    pub upload_bytes_per_sec: u64,
    pub session_download_bytes: u64,
    pub session_upload_bytes: u64,
    pub cpu_percent: f32,
    pub memory_bytes: u64,
}

#[derive(Serialize, Clone, Debug)]
pub struct ProcessActivitySnapshot {
    pub source: String,
    pub error: Option<String>,
    pub processes: Vec<ProcessActivityInfo>,
}

struct AppState {
    network_sampler: Arc<Mutex<NetworkSampler>>,
    process_network_monitor: ProcessNetworkMonitor,
    sys: Arc<Mutex<System>>,
}

#[tauri::command]
fn get_network_interfaces(state: State<AppState>) -> Vec<String> {
    state.network_sampler.lock().unwrap().interface_names()
}

#[tauri::command]
async fn get_current_network_identity() -> Result<NetworkIdentity, String> {
    tauri::async_runtime::spawn_blocking(detect_current_network_identity)
        .await
        .map_err(|error| format!("네트워크 식별 작업에 실패했습니다: {error}"))?
}

#[tauri::command]
fn kill_process(target_pid: u32, state: State<AppState>) -> bool {
    if target_pid == std::process::id() {
        return false;
    }
    let mut sys = state.sys.lock().unwrap();
    sys.refresh_processes();

    let pid = Pid::from(target_pid as usize);
    if let Some(process) = sys.process(pid) {
        println!(
            "[KillProcess] Terminating process {} (PID: {})",
            process.name(),
            target_pid
        );
        return process.kill();
    }
    false
}

#[tauri::command]
fn update_tray_tooltip(tooltip: String, app_handle: tauri::AppHandle) {
    let _ = app_handle.tray_handle().set_tooltip(&tooltip);
}

#[tauri::command]
fn set_auto_start(enable: bool) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        if let Ok(exe_path) = std::env::current_exe() {
            let exe_str = exe_path.to_string_lossy().to_string();
            if enable {
                let output = std::process::Command::new("reg")
                    .args([
                        "add",
                        "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                        "/v",
                        "DolphinData",
                        "/t",
                        "REG_SZ",
                        "/d",
                        &format!("\"{}\"", exe_str),
                        "/f",
                    ])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output()
                    .map_err(|error| error.to_string())?;
                if !output.status.success() {
                    return Err(String::from_utf8_lossy(&output.stderr).to_string());
                }
                return Ok(true);
            } else {
                let output = std::process::Command::new("reg")
                    .args([
                        "delete",
                        "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                        "/v",
                        "DolphinData",
                        "/f",
                    ])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output()
                    .map_err(|error| error.to_string())?;
                if !output.status.success() && get_auto_start() {
                    return Err(String::from_utf8_lossy(&output.stderr).to_string());
                }
                return Ok(false);
            }
        }
    }
    Err("자동 시작 설정은 Windows에서만 지원됩니다.".to_string())
}

#[tauri::command]
fn get_auto_start() -> bool {
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = std::process::Command::new("reg")
            .args([
                "query",
                "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                "/v",
                "DolphinData",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            return output.status.success();
        }
    }
    false
}

#[tauri::command]
fn set_mini_mode(mini: bool, window: tauri::Window) {
    if mini {
        let _ = window.set_resizable(true);
        let _ = window.set_min_size(Some(LogicalSize::new(260.0, 120.0)));
        let _ = window.set_size(LogicalSize::new(320.0, 150.0));
        let _ = window.set_always_on_top(true);
    } else {
        let _ = window.set_min_size(Some(LogicalSize::new(600.0, 450.0)));
        let _ = window.set_size(LogicalSize::new(1120.0, 760.0));
        let _ = window.set_always_on_top(false);
        let _ = window.center();
    }
}

#[tauri::command]
fn get_top_processes(state: State<AppState>) -> ProcessActivitySnapshot {
    let mut sys = state.sys.lock().unwrap();
    sys.refresh_processes();
    let active_pids: HashSet<u32> = sys.processes().keys().map(|pid| pid.as_u32()).collect();
    let network = state.process_network_monitor.sample(&active_pids);

    let mut list: Vec<ProcessActivityInfo> = Vec::new();

    for (pid, process) in sys.processes() {
        let cpu = process.cpu_usage();
        let mem = process.memory();

        let usage = network
            .usage_by_pid
            .get(&pid.as_u32())
            .copied()
            .unwrap_or_default();
        let network_bytes_per_sec = usage
            .download_bytes_per_sec
            .saturating_add(usage.upload_bytes_per_sec);
        let session_network_bytes = usage
            .session_download_bytes
            .saturating_add(usage.session_upload_bytes);

        if network_bytes_per_sec > 0
            || session_network_bytes > 0
            || cpu > 0.05
            || mem > 30 * 1024 * 1024
        {
            list.push(ProcessActivityInfo {
                pid: pid.as_u32(),
                name: process.name().to_string(),
                download_bytes_per_sec: usage.download_bytes_per_sec,
                upload_bytes_per_sec: usage.upload_bytes_per_sec,
                session_download_bytes: usage.session_download_bytes,
                session_upload_bytes: usage.session_upload_bytes,
                cpu_percent: cpu,
                memory_bytes: mem,
            });
        }
    }

    list.sort_by(|a, b| {
        b.download_bytes_per_sec
            .saturating_add(b.upload_bytes_per_sec)
            .cmp(
                &a.download_bytes_per_sec
                    .saturating_add(a.upload_bytes_per_sec),
            )
            .then_with(|| {
                b.session_download_bytes
                    .saturating_add(b.session_upload_bytes)
                    .cmp(
                        &a.session_download_bytes
                            .saturating_add(a.session_upload_bytes),
                    )
            })
            .then_with(|| {
                b.cpu_percent
                    .partial_cmp(&a.cpu_percent)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| b.memory_bytes.cmp(&a.memory_bytes))
    });
    list.truncate(12);
    ProcessActivitySnapshot {
        source: network.source,
        error: network.error,
        processes: list,
    }
}

#[tauri::command]
async fn run_ping_test(host: String) -> Result<u64, String> {
    if !is_valid_ping_host(&host) {
        return Err("유효하지 않은 Ping 대상입니다.".to_string());
    }
    // ping.exe blocks for up to the echo timeout; keep it off the UI thread.
    tauri::async_runtime::spawn_blocking(move || ping_once(&host))
        .await
        .map_err(|error| error.to_string())?
}

fn ping_once(host: &str) -> Result<u64, String> {
    let mut command = std::process::Command::new("ping");
    #[cfg(target_os = "windows")]
    {
        command.args(["-n", "1", "-w", "2000", host]);
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(target_os = "windows"))]
    {
        command.args(["-c", "1", "-W", "2", host]);
    }

    let output = command.output().map_err(|error| error.to_string())?;
    // Windows ping exits 0 for "Destination host unreachable", so require a real echo reply.
    parse_ping_ms(&String::from_utf8_lossy(&output.stdout))
        .filter(|_| output.status.success())
        .ok_or_else(|| "Ping 대상에서 응답을 받지 못했습니다.".to_string())
}

#[tauri::command]
fn get_realtime_stats(target_interface: String, state: State<AppState>) -> TelemetryData {
    state
        .network_sampler
        .lock()
        .unwrap()
        .sample(&target_interface)
}

fn main() {
    #[cfg(target_os = "windows")]
    let single_instance_guard = match acquire_single_instance(
        std::env::args_os().any(|arg| arg == ELEVATED_RELAUNCH_ARG),
    ) {
        Ok(Some(guard)) => guard,
        Ok(None) => return,
        Err(error) => {
            eprintln!("{error}");
            return;
        }
    };

    let mut sys = System::new_all();
    sys.refresh_processes();

    let state = AppState {
        network_sampler: Arc::new(Mutex::new(NetworkSampler::new())),
        process_network_monitor: ProcessNetworkMonitor::start(),
        sys: Arc::new(Mutex::new(sys)),
    };

    // System Tray Menu Items
    let show = CustomMenuItem::new("show".to_string(), "대시보드 열기 (Open)");
    let mini = CustomMenuItem::new("mini".to_string(), "미니 가젯 모드 (Mini Gadget)");
    let quit = CustomMenuItem::new("quit".to_string(), "종료 (Exit)");
    let tray_menu = SystemTrayMenu::new()
        .add_item(show)
        .add_item(mini)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(quit);

    let system_tray = SystemTray::new()
        .with_menu(tray_menu)
        .with_tooltip("돌핀 데이터 (Dolphin Data) - 실시간 데이터 모니터");

    tauri::Builder::default()
        .setup(move |app| {
            #[cfg(target_os = "windows")]
            {
                listen_for_relaunch(app.handle(), single_instance_guard.event);
                app.manage(single_instance_guard);
            }
            Ok(())
        })
        .manage(state)
        .system_tray(system_tray)
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::LeftClick { .. } => {
                if let Some(window) = app.get_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
                "show" => {
                    if let Some(window) = app.get_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                        let _ = window.set_min_size(Some(LogicalSize::new(600.0, 450.0)));
                        let _ = window.set_size(LogicalSize::new(1120.0, 760.0));
                        let _ = window.set_always_on_top(false);
                        let _ = window.center();
                        let _ = window.emit("toggle-mini", false);
                    }
                }
                "mini" => {
                    if let Some(window) = app.get_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                        let _ = window.set_min_size(Some(LogicalSize::new(260.0, 120.0)));
                        let _ = window.set_size(LogicalSize::new(320.0, 150.0));
                        let _ = window.set_always_on_top(true);
                        let _ = window.emit("toggle-mini", true);
                    }
                }
                "quit" => {
                    std::process::exit(0);
                }
                _ => {}
            },
            _ => {}
        })
        .on_window_event(|event| {
            if let WindowEvent::CloseRequested { api, .. } = event.event() {
                // Intercept close button to hide window to system tray
                api.prevent_close();
                let _ = event.window().hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_network_interfaces,
            get_current_network_identity,
            get_diagnostic_environment,
            get_diagnostic_intake,
            submit_diagnostic_report,
            get_realtime_stats,
            get_top_processes,
            kill_process,
            run_ping_test,
            set_mini_mode,
            update_tray_tooltip,
            set_auto_start,
            get_auto_start,
            is_running_as_admin,
            relaunch_as_admin
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
