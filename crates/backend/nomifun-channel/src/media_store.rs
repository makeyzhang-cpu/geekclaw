//! Persistent media store for channel plugins.
//!
//! When a platform pushes a media item that needs decryption (WeCom aibot
//! image, WeChat iLink CDN files) we keep the decrypted bytes in a per-bot
//! directory under `data_dir/channel-media/` and expose them via
//! [`crate::routes::media_download_route`] at `/api/channel/media/{key}.{ext}`.
//!
//! Storage layout:
//! ```text
//! {data_dir}/channel-media/{key}.{ext}
//! ```
//!
//! `key` is a 16-byte random hex string; `ext` is the platform's reported
//! MIME-derived extension (e.g. `png`, `jpg`). No DB row yet — v1 read-only
//! resolve, no GC. Files older than the process lifetime are left to OS /
//! operator cleanup.

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use thiserror::Error;

const MEDIA_SUBDIR: &str = "channel-media";

#[derive(Debug, Error)]
pub enum MediaStoreError {
    #[error("channel media store path is invalid: {0}")]
    InvalidPath(String),
    #[error("invalid media key '{0}' (must be 32 lowercase hex chars)")]
    InvalidKey(String),
    #[error("media key not found: {0}")]
    NotFound(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

/// On-disk store of decrypted channel media. Cheap to clone (Arc internals).
#[derive(Clone)]
pub struct ChannelMediaStore {
    root: PathBuf,
}

impl ChannelMediaStore {
    /// Build a store rooted under `data_dir`; the directory is created on
    /// first store.
    pub fn new(data_dir: &Path) -> Result<Self, MediaStoreError> {
        if data_dir.as_os_str().is_empty() {
            return Err(MediaStoreError::InvalidPath(
                "data_dir must not be empty".into(),
            ));
        }
        let root = data_dir.join(MEDIA_SUBDIR);
        std::fs::create_dir_all(&root)?;
        Ok(Self { root })
    }

    /// Stores `bytes` and returns a `(key, suggested_ext)` pair.
    ///
    /// `suggested_ext` is a hint from the caller (MIME guess / platform
    /// hint); the file is written as `{key}.{ext}`. Files within the store
    /// are content-addressed by `key`, so writing the same bytes twice
    /// yields two distinct files. We key by random hex, not content hash,
    /// so two similar but distinct received files don't collide.
    pub fn store(
        &self,
        bytes: &[u8],
        suggested_ext: &str,
    ) -> Result<(String, String), MediaStoreError> {
        use rand::RngCore;
        let mut key_bytes = [0u8; 16];
        rand::rngs::OsRng.fill_bytes(&mut key_bytes);
        let key = hex_lower(&key_bytes);
        let ext = sanitize_ext(suggested_ext);
        let path = self.file_path(&key, &ext);
        std::fs::write(&path, bytes)?;
        Ok((key, ext))
    }

    /// Resolves a stored file. Validates `key` strictly (32 lowercase hex)
    /// to make the file path a function of user input without traversal
    /// risk: even if `ext` were `../../etc/passwd`, the key never makes it
    /// past the matcher.
    pub fn read(&self, key: &str, ext: &str) -> Result<Vec<u8>, MediaStoreError> {
        if !is_valid_key(key) {
            return Err(MediaStoreError::InvalidKey(key.to_owned()));
        }
        let ext = sanitize_ext(ext);
        let path = self.file_path(key, &ext);
        match std::fs::read(&path) {
            Ok(bytes) => Ok(bytes),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                Err(MediaStoreError::NotFound(format!("{key}.{ext}")))
            }
            Err(e) => Err(MediaStoreError::Io(e)),
        }
    }

    /// Resolves the path for `key`. Used by the axum handler when streaming
    /// the file off disk to avoid an intermediate allocation.
    pub fn path(&self, key: &str, ext: &str) -> Result<PathBuf, MediaStoreError> {
        if !is_valid_key(key) {
            return Err(MediaStoreError::InvalidKey(key.to_owned()));
        }
        Ok(self.file_path(key, &sanitize_ext(ext)))
    }

    fn file_path(&self, key: &str, ext: &str) -> PathBuf {
        self.root.join(format!("{key}.{ext}"))
    }

    /// URL that the channel layer hands to the inbox / message loop:
    /// `/api/channel/media/{key}.{ext}`.
    pub fn url_for(key: &str, ext: &str) -> String {
        let safe_ext = sanitize_ext(ext);
        format!("/api/channel/media/{key}.{safe_ext}")
    }

    /// Hashes the original aibot download URL + aeskey pair (or any other
    /// natural key) for diagnostics: it never becomes the file key (we
    /// store with a fresh random key) but is useful in `debug!` logs.
    pub fn fingerprint(parts: &[&str]) -> String {
        let mut hasher = Sha256::new();
        for p in parts {
            hasher.update(p.as_bytes());
            hasher.update(b"\0");
        }
        hex_lower(&hasher.finalize()[..8])
    }
}

fn is_valid_key(key: &str) -> bool {
    key.len() == 32
        && key.bytes()
            .all(|b| b.is_ascii_digit() || matches!(b, b'a'..=b'f'))
}

fn sanitize_ext(ext: &str) -> String {
    let s = ext.trim().trim_start_matches('.').to_ascii_lowercase();
    // Strip everything but [a-z0-9] to prevent any path-traversal payload
    // even though we already gate the directory with the key.
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect()
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn store_and_read_roundtrip() {
        let dir = TempDir::new().unwrap();
        let store = ChannelMediaStore::new(dir.path()).unwrap();
        let (key, ext) = store.store(b"hello world", "png").unwrap();
        assert_eq!(key.len(), 32);
        assert_eq!(ext, "png");
        let body = store.read(&key, &ext).unwrap();
        assert_eq!(body, b"hello world");
    }

    #[test]
    fn read_rejects_invalid_key() {
        let dir = TempDir::new().unwrap();
        let store = ChannelMediaStore::new(dir.path()).unwrap();
        // Path traversal / arbitrary name (rejected).
        assert!(matches!(
            store.read("../../etc/passwd", "png"),
            Err(MediaStoreError::InvalidKey(_))
        ));
        // Empty.
        assert!(matches!(
            store.read("", "png"),
            Err(MediaStoreError::InvalidKey(_))
        ));
        // Capital hex.
        assert!(matches!(
            store.read("DEADBEEFDEADBEEFDEADBEEFDEADBEEF", "png"),
            Err(MediaStoreError::InvalidKey(_))
        ));
    }

    #[test]
    fn read_missing_returns_not_found() {
        let dir = TempDir::new().unwrap();
        let store = ChannelMediaStore::new(dir.path()).unwrap();
        // Valid key shape but no file present.
        let err = store.read("00000000000000000000000000000000", "png").unwrap_err();
        assert!(matches!(err, MediaStoreError::NotFound(_)));
    }

    #[test]
    fn extension_sanitization_strips_path_traversal() {
        assert_eq!(sanitize_ext("PNG"), "png");
        assert_eq!(sanitize_ext(".png"), "png");
        assert_eq!(sanitize_ext("../../../etc/passwd"), "etcpasswd");
        assert_eq!(sanitize_ext("foo bar"), "foobar");
        assert_eq!(sanitize_ext("verylongname"), "verylongn"); // clipped to 8
        assert_eq!(sanitize_ext(""), "");
    }

    #[test]
    fn fingerprint_changes_when_input_changes() {
        let a = ChannelMediaStore::fingerprint(&["u1", "k1"]);
        let b = ChannelMediaStore::fingerprint(&["u1", "k2"]);
        assert_ne!(a, b);
        assert_eq!(a.len(), 16);
    }

    #[test]
    fn url_for_uses_sanitized_ext() {
        let url = ChannelMediaStore::url_for(
            "00000000000000000000000000000000",
            "../../etc/passwd",
        );
        // Path components are stripped; only the sanitized ext leaks.
        assert_eq!(url, "/api/channel/media/00000000000000000000000000000000.etcpasswd");
    }
}
