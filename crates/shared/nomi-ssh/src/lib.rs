//! Pure russh transport adapter for GeekClaw's SSH remote sessions.
//!
//! This crate has zero dependency on the geekclaw-*/geekclaw-* crates: it can be
//! built and tested against a real sshd in isolation. Backend integration
//! (host book, connection pool, HTTP routes) lives in
//! `crates/backend/nomifun-ssh`, which reaches the agent layer through the
//! `nomifun-ai-agent` seam. Keeping the transport here means russh — a crate
//! with a fast-churning `Handler` API — is never a transitive dependency of
//! `geekclaw-tools` / `geekclaw-agent` / `nomifun-terminal`.

pub mod connection;
pub mod credential;
pub mod fs;
pub mod responder;
pub mod shell;
