//! AES-256-CBC decryption for the WeCom (企业微信) intelligent-bot
//! long-connection mode.
//!
//! Per the official aibot SDK reference: every media URL the aibot pushes in
//! `aibot_msg_callback` carries a per-resource `aeskey` field that the receiver
//! must use to decrypt the file content downloaded from `image.url`.
//!
//! Quoted spec (Corporate WeCom docs / `@wecom/aibot-node-sdk` /
//! `dividduang/aibot-python-sdk` / Tencent/WeKnora):
//!
//! * Algorithm: AES-256-CBC
//! * Key: the literal UTF-8 bytes of the `aeskey` callback field
//!   (a 32-character ASCII string; **not** base64).
//! * IV: the first 16 bytes of the key.
//! * Padding: PKCS#7 (ciphertext is a multiple of 16 bytes; trailing pad bytes
//!   equal the pad length itself).
//!
//! `decrypt_media_bytes` is pure — easy to unit-test with a known plaintext /
//! ciphertext pair.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum WecomCryptoError {
    #[error("WeCom aeskey must be exactly 32 UTF-8 bytes, got {0}")]
    InvalidAesKeyLength(usize),
    #[error("ciphertext length {0} is not a positive multiple of 16 (AES block size)")]
    InvalidCiphertextLength(usize),
    #[error("PKCS#7 padding is invalid: {0}")]
    InvalidPadding(String),
}

/// Decrypt a media body downloaded from an aibot `body.image.url` link.
///
/// `aeskey_utf8` is the literal `aeskey` field from the `aibot_msg_callback`
/// body (`image.aeskey`); it must be a 32-character ASCII string per the
/// platform spec. `ciphertext` is the raw byte body of the HTTP GET to
/// `body.image.url`.
pub fn decrypt_media_bytes(aeskey_utf8: &str, ciphertext: &[u8]) -> Result<Vec<u8>, WecomCryptoError> {
    use aes::Aes256;
    use cbc::cipher::block_padding::Pkcs7;
    use cbc::cipher::{BlockDecryptMut, KeyIvInit};
    use cbc::Decryptor;

    let key = aeskey_utf8.as_bytes();
    if key.len() != 32 {
        return Err(WecomCryptoError::InvalidAesKeyLength(key.len()));
    }
    if ciphertext.is_empty() || ciphertext.len() % 16 != 0 {
        return Err(WecomCryptoError::InvalidCiphertextLength(ciphertext.len()));
    }

    let iv: [u8; 16] = key[..16].try_into().expect("key length checked above");
    let key_arr: [u8; 32] = key.try_into().expect("key length checked above");

    type Aes256CbcDec = Decryptor<Aes256>;
    let decryptor = Aes256CbcDec::new(&key_arr.into(), &iv.into());

    let mut buf = ciphertext.to_vec();
    let plaintext = decryptor
        .decrypt_padded_mut::<Pkcs7>(&mut buf)
        .map_err(|e| WecomCryptoError::InvalidPadding(e.to_string()))?
        .to_vec();
    Ok(plaintext)
}

#[cfg(test)]
mod tests {
    use super::*;
    use aes::Aes256;
    use cbc::cipher::block_padding::Pkcs7;
    use cbc::cipher::{BlockEncryptMut, KeyIvInit};
    use cbc::Encryptor;

    type Aes256CbcEnc = Encryptor<Aes256>;

    /// Build a known ciphertext with the standard aibot algorithm so we can
    /// assert the decryptor inverts it exactly.
    fn make_test_vector() -> (String, Vec<u8>, Vec<u8>) {
        let aeskey = "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345".to_owned();
        let plaintext =
            b"https://ww-aibot-img.example.cos.ap-shanghai.myqcloud.com/abc?sign=xx".to_vec();

        let key = aeskey.as_bytes();
        let iv: [u8; 16] = key[..16].try_into().unwrap();
        let key_arr: [u8; 32] = key.try_into().unwrap();
        // PKCS#7 pads to the next 16-byte boundary (≤ 16 extra bytes).
        // `encrypt_padded_mut` writes the pad region itself, but the
        // *destination* slice must already be long enough — cipher 0.4's
        // `&mut [u8]` bound is on length, not on Vec capacity. Resize to
        // the padded length up-front so the call doesn't return PadError.
        let pad_len = 16 - (plaintext.len() % 16);
        let padded_len = plaintext.len() + pad_len;
        let mut buf = vec![0u8; padded_len];
        buf[..plaintext.len()].copy_from_slice(&plaintext);
        let ciphertext = Aes256CbcEnc::new(&key_arr.into(), &iv.into())
            .encrypt_padded_mut::<Pkcs7>(&mut buf, plaintext.len())
            .unwrap()
            .to_vec();
        (aeskey, ciphertext, plaintext)
    }

    #[test]
    fn decryptor_inverts_aes256_cbc_with_pkcs7() {
        let (aeskey, ciphertext, expected) = make_test_vector();
        let plain = decrypt_media_bytes(&aeskey, &ciphertext).unwrap();
        assert_eq!(plain, expected);
    }

    #[test]
    fn plaintext_is_valid_utf8_so_textual_urls_round_trip() {
        let (aeskey, ciphertext, expected) = make_test_vector();
        let plain = decrypt_media_bytes(&aeskey, &ciphertext).unwrap();
        let url = std::str::from_utf8(&plain).expect("aibot URLs are UTF-8");
        assert_eq!(url, std::str::from_utf8(&expected).unwrap());
    }

    #[test]
    fn rejects_wrong_key_length() {
        let key = "ABCDEFGHIJKLMNOPQRSTUVWXYZ01234"; // 31 bytes
        let ct = vec![0u8; 16];
        let err = decrypt_media_bytes(key, &ct).unwrap_err();
        assert!(matches!(err, WecomCryptoError::InvalidAesKeyLength(31)));
    }

    #[test]
    fn rejects_non_block_aligned_ciphertext() {
        let key = "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
        let ct = vec![0u8; 15]; // not a multiple of 16
        let err = decrypt_media_bytes(key, &ct).unwrap_err();
        assert!(matches!(err, WecomCryptoError::InvalidCiphertextLength(15)));
    }

    #[test]
    fn rejects_empty_ciphertext() {
        let key = "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
        let err = decrypt_media_bytes(key, &[]).unwrap_err();
        assert!(matches!(err, WecomCryptoError::InvalidCiphertextLength(0)));
    }

    #[test]
    fn rejects_truncated_pkcs7_padding() {
        // A 16-byte block whose only byte is 0x10 → asks for 16 bytes of padding, which is
        // one more than a block. cbc must reject this as InvalidPadding rather than panic.
        let key = "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
        let bad_ct = vec![0x10u8; 16];
        let err = decrypt_media_bytes(key, &bad_ct).unwrap_err();
        assert!(matches!(err, WecomCryptoError::InvalidPadding(_)));
    }
}
