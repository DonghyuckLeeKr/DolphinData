use std::net::IpAddr;

/// Accepts only an IP literal or a DNS hostname so the value can never be parsed as a ping flag.
pub fn is_valid_ping_host(host: &str) -> bool {
    if host.parse::<IpAddr>().is_ok() {
        return true;
    }
    if host.is_empty() || host.len() > 253 {
        return false;
    }
    host.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
    })
}

/// Reads the round-trip time from a single-echo ping output ("time=12ms", "시간<1ms").
/// Returns None when no echo reply was received, e.g. "Destination host unreachable".
pub fn parse_ping_ms(output: &str) -> Option<u64> {
    output
        .lines()
        .filter(|line| line.contains("TTL=") || line.contains("ttl="))
        .find_map(|line| {
            line.replace(" ms", "ms")
                .split_whitespace()
                .find_map(|token| {
                    let value = token.strip_suffix("ms")?;
                    let start = value.rfind(['=', '<'])? + 1;
                    let millis = value[start..].parse::<f64>().ok()?;
                    Some((millis.round() as u64).max(1))
                })
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_flag_like_hosts() {
        for host in ["-t", "-n", "--help", "a..b", "", "host-", "bad host", "a/b"] {
            assert!(!is_valid_ping_host(host), "{host}");
        }
    }

    #[test]
    fn accepts_ip_literals_and_hostnames() {
        for host in ["8.8.8.8", "::1", "fe80::1", "dns.google", "my-router.local"] {
            assert!(is_valid_ping_host(host), "{host}");
        }
    }

    #[test]
    fn parses_round_trip_from_localized_output() {
        assert_eq!(
            parse_ping_ms("8.8.8.8의 응답: 바이트=32 시간=31ms TTL=117"),
            Some(31)
        );
        assert_eq!(
            parse_ping_ms("Reply from 8.8.8.8: bytes=32 time<1ms TTL=117"),
            Some(1)
        );
        assert_eq!(
            parse_ping_ms("64 bytes from 8.8.8.8: icmp_seq=1 ttl=117 time=12.6 ms"),
            Some(13)
        );
        assert_eq!(
            parse_ping_ms("64 bytes from 8.8.8.8: icmp_seq=1 ttl=117 time=12.6ms"),
            Some(13)
        );
    }

    #[test]
    fn unreachable_reply_is_not_a_success() {
        assert_eq!(
            parse_ping_ms("Reply from 192.168.0.1: Destination host unreachable."),
            None
        );
    }
}
