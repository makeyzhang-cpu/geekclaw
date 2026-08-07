//! geekclaw-ssh must stay a pure transport adapter — no backend/agent/db/tauri deps.
//! This contract fails the build if a forbidden dependency is ever added,
//! preserving the isolation that keeps russh out of the agent/tool crates.
use std::fs;

#[test]
fn manifest_declares_no_forbidden_dependencies() {
    let manifest = fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/Cargo.toml"))
        .expect("read own Cargo.toml");
    for forbidden in [
        "geekclaw-",
        "geekclaw-types",
        "geekclaw-agent",
        "geekclaw-tools",
        "rusqlite",
        "sqlx",
        "tauri",
    ] {
        assert!(
            !manifest.contains(forbidden),
            "geekclaw-ssh must remain transport-neutral, found dependency `{forbidden}`"
        );
    }
}
