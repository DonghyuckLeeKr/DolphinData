use reqwest::{redirect::Policy, Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

const CONFIG_URL: &str = "https://raw.githubusercontent.com/DonghyuckLeeKr/DolphinData/main/support/diagnostic-intake.json";
const LOCAL_ENDPOINT: &str = "http://127.0.0.1:4175/v1/reports";
const MAX_BYTES: usize = 256 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IntakeConfig {
    schema_version: u8,
    endpoint: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntakeTarget {
    pub mode: &'static str,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticReceipt {
    report_id: String,
    receipt_id: String,
    received_at: String,
}

fn client() -> Result<Client, String> {
    Client::builder()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "접수 연결을 준비하지 못했습니다.".to_string())
}

async fn small_body(mut response: reqwest::Response) -> Result<Vec<u8>, String> {
    let failure = || "접수 연결 결과를 확인하지 못했습니다. 다시 접수해주세요.".to_string();
    if response.content_length().unwrap_or(0) > 4096 {
        return Err(failure());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| failure())? {
        if bytes.len() + chunk.len() > 4096 {
            return Err(failure());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn public_endpoint(endpoint: &str) -> Result<Url, String> {
    let url = Url::parse(endpoint).map_err(|_| "접수 주소 설정을 확인해주세요.".to_string())?;
    // The repository config is maintained by the operator. A report cannot
    // supply an arbitrary destination or local-network URL through IPC.
    let host = url.host_str().unwrap_or_default();
    if url.scheme() != "https"
        || !host.ends_with(".trycloudflare.com")
        || host.len() <= ".trycloudflare.com".len()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.path() != "/v1/reports"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("접수 주소 설정을 확인해주세요.".to_string());
    }
    Ok(url)
}

async fn resolve(client: &Client) -> Result<(Url, &'static str), String> {
    if let Ok(response) = client.get(CONFIG_URL).send().await {
        if response.status().is_success() && response.content_length().unwrap_or(0) <= 4096 {
            let bytes = small_body(response).await?;
            if bytes.len() > 4096 {
                return Err("접수 주소 설정을 확인해주세요.".to_string());
            }
            let config: IntakeConfig = serde_json::from_slice(&bytes)
                .map_err(|_| "접수 주소 설정을 확인해주세요.".to_string())?;
            if config.schema_version != 1 {
                return Err("앱 업데이트 후 다시 접수해주세요.".to_string());
            }
            if !config.endpoint.is_empty() {
                return Ok((public_endpoint(&config.endpoint)?, "public"));
            }
        }
    }
    // The initially selected operating mode is a local PC. Never pretend that
    // localhost on another user's machine is the developer's intake server.
    let status = client
        .get("http://127.0.0.1:4175/v1/status")
        .send()
        .await
        .map_err(|_| {
            "접수 서버에 연결하지 못했습니다. 기록은 보관되므로 인터넷 연결 후 다시 접수해주세요."
                .to_string()
        })?;
    if !status.status().is_success() || status.content_length().unwrap_or(0) > 4096 {
        return Err("접수 서버 연결을 확인해주세요.".to_string());
    }
    let bytes = small_body(status).await?;
    let value: Value = if bytes.len() <= 4096 {
        serde_json::from_slice(&bytes).ok()
    } else {
        None
    }
    .ok_or_else(|| "접수 서버 연결을 확인해주세요.".to_string())?;
    if value["service"] != "DolphinData diagnostic intake" || value["schemaVersion"] != 1 {
        return Err("접수 서버 연결을 확인해주세요.".to_string());
    }
    Ok((Url::parse(LOCAL_ENDPOINT).unwrap(), "local"))
}

pub async fn target() -> Result<IntakeTarget, String> {
    let client = client()?;
    let (endpoint, mode) = resolve(&client).await?;
    if mode == "public" {
        let status_url = endpoint
            .join("/v1/status")
            .map_err(|_| "접수 주소 설정을 확인해주세요.".to_string())?;
        let response = client
            .get(status_url)
            .send()
            .await
            .map_err(|_| "접수 서버에 연결하지 못했습니다.".to_string())?;
        if !response.status().is_success() {
            return Err("접수 서버에 연결하지 못했습니다.".to_string());
        }
        let status: Value = serde_json::from_slice(&small_body(response).await?)
            .map_err(|_| "접수 서버 연결을 확인해주세요.".to_string())?;
        if status["service"] != "DolphinData diagnostic intake" || status["schemaVersion"] != 1 {
            return Err("접수 서버 연결을 확인해주세요.".to_string());
        }
    }
    Ok(IntakeTarget { mode })
}

async fn post(client: &Client, endpoint: Url, report: Value) -> Result<DiagnosticReceipt, String> {
    let body =
        serde_json::to_vec(&report).map_err(|_| "리포트 내용을 확인해주세요.".to_string())?;
    if body.len() > MAX_BYTES
        || report["schemaVersion"] != 1
        || !valid_id(report["reportId"].as_str().unwrap_or_default())
    {
        return Err("리포트 내용을 확인해주세요.".to_string());
    }
    let response = client
        .post(endpoint)
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|_| {
            "전송을 완료하지 못했습니다. 기록은 보관되므로 연결 후 ‘다시 접수’를 눌러주세요."
                .to_string()
        })?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            429 => "접수가 몰리고 있습니다. 1분 뒤 다시 접수해주세요.",
            413 => "진단 리포트가 너무 큽니다. 새 기록을 시작해주세요.",
            400 => "접수하지 못했습니다. 기록을 확인하거나 잠시 후 다시 접수해주세요.",
            _ => "접수 서버가 응답하지 않습니다. 잠시 후 다시 접수해주세요.",
        }
        .to_string());
    }
    if response.content_length().unwrap_or(0) > 4096 {
        return Err("접수 결과를 확인하지 못했습니다. 다시 접수해주세요.".to_string());
    }
    let bytes = small_body(response).await?;
    let receipt: DiagnosticReceipt = if bytes.len() <= 4096 {
        serde_json::from_slice(&bytes).ok()
    } else {
        None
    }
    .ok_or_else(|| "접수 결과를 확인하지 못했습니다. 다시 접수해주세요.".to_string())?;
    if Some(receipt.report_id.as_str()) != report["reportId"].as_str()
        || !valid_id(&receipt.receipt_id)
        || receipt.received_at.len() > 40
    {
        return Err("접수 결과를 확인하지 못했습니다. 다시 접수해주세요.".to_string());
    }
    Ok(receipt)
}

pub async fn submit(report: Value) -> Result<DiagnosticReceipt, String> {
    let client = client()?;
    let (endpoint, _) = resolve(&client).await?;
    post(&client, endpoint, report).await
}

fn valid_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn native_submission_verifies_receipt_and_does_not_follow_redirects() {
        for status in [201, 302] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let endpoint = Url::parse(&format!(
                "http://{}/v1/reports",
                listener.local_addr().unwrap()
            ))
            .unwrap();
            let worker = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut buffer = [0; 4096];
                let size = stream.read(&mut buffer).unwrap();
                let request = String::from_utf8_lossy(&buffer[..size]);
                assert!(request.starts_with("POST /v1/reports"));
                assert!(!request.to_lowercase().contains("authorization:"));
                let body = r#"{"reportId":"12345678-1234-1234-1234-123456789abc","receiptId":"87654321-1234-1234-1234-123456789abc","receivedAt":"2026-10-11T00:00:00Z"}"#;
                write!(stream, "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nLocation: http://127.0.0.1:1/secrets\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            });
            let result = tauri::async_runtime::block_on(post(
                &client().unwrap(),
                endpoint,
                serde_json::json!({"schemaVersion":1,"reportId":"12345678-1234-1234-1234-123456789abc"}),
            ));
            assert_eq!(result.is_ok(), status == 201);
            worker.join().unwrap();
        }
    }

    #[test]
    fn destinations_are_https_intake_only() {
        assert!(public_endpoint("https://example.trycloudflare.com/v1/reports").is_ok());
        for url in [
            "http://example.trycloudflare.com/v1/reports",
            "https://example.com/v1/reports",
            "http://127.0.0.1:4174/api/reports",
            "https://user:secret@example.trycloudflare.com/v1/reports",
            "https://example.trycloudflare.com/api/status",
            "https://example.trycloudflare.com/v1/reports?secret=1",
        ] {
            assert!(public_endpoint(url).is_err(), "{url}");
        }
    }

    #[test]
    fn receipts_require_real_identifiers() {
        assert!(valid_id("12345678-1234-1234-1234-123456789abc"));
        assert!(!valid_id("12345678-1234-1234-1234-123456789abz"));
        assert!(!valid_id("../../secrets"));
    }
}
