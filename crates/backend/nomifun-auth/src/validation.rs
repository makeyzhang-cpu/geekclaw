use crate::error::AuthError;

const MIN_PASSWORD_LENGTH: usize = 8;
const MAX_PASSWORD_LENGTH: usize = 128;
const MIN_USERNAME_LENGTH: usize = 3;
const MAX_USERNAME_LENGTH: usize = 32;

/// Common weak passwords rejected during validation.
const WEAK_PASSWORDS: &[&str] = &["password", "12345678", "123456789", "qwertyui", "abcdefgh"];

/// Validate password strength.
///
/// Rules:
/// - Length: 8-128 characters
/// - Not in the weak password blacklist (case-insensitive)
pub fn validate_password(password: &str) -> Result<(), AuthError> {
    if password.len() < MIN_PASSWORD_LENGTH {
        return Err(AuthError::WeakPassword(format!(
            "Password must be at least {MIN_PASSWORD_LENGTH} characters"
        )));
    }
    if password.len() > MAX_PASSWORD_LENGTH {
        return Err(AuthError::WeakPassword(format!(
            "Password must not exceed {MAX_PASSWORD_LENGTH} characters"
        )));
    }
    let lower = password.to_lowercase();
    if WEAK_PASSWORDS.contains(&lower.as_str()) {
        return Err(AuthError::WeakPassword("Password is too common".into()));
    }
    Ok(())
}

/// Validate username format.
///
/// Rules:
/// - Length: 3-32 Unicode characters (CJK names are supported)
/// - Allowed characters: Unicode letters/digits, ASCII `_`, and `-`
/// - Must not start or end with `-` or `_`
pub fn validate_username(username: &str) -> Result<(), AuthError> {
    let char_count = username.chars().count();
    if char_count < MIN_USERNAME_LENGTH {
        return Err(AuthError::InvalidUsername(format!(
            "Username must be at least {MIN_USERNAME_LENGTH} characters"
        )));
    }
    if char_count > MAX_USERNAME_LENGTH {
        return Err(AuthError::InvalidUsername(format!(
            "Username must not exceed {MAX_USERNAME_LENGTH} characters"
        )));
    }
    if !username
        .chars()
        .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
    {
        return Err(AuthError::InvalidUsername(
            "Username may only contain letters, digits, underscores, hyphens, or CJK characters".into(),
        ));
    }
    // Length >= 3, so first and last chars are guaranteed to exist.
    let first = username.chars().next().unwrap();
    let last = username.chars().last().unwrap();
    if matches!(first, '-' | '_') || matches!(last, '-' | '_') {
        return Err(AuthError::InvalidUsername(
            "Username must not start or end with a hyphen or underscore".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- Password validation ---

    #[test]
    fn valid_password() {
        assert!(validate_password("StrongP@ss1").is_ok());
    }

    #[test]
    fn password_exactly_min_length_valid() {
        assert!(validate_password("abcDEF12").is_ok());
    }

    #[test]
    fn password_exactly_max_length() {
        let max = "a".repeat(128);
        assert!(validate_password(&max).is_ok());
    }

    #[test]
    fn password_too_short() {
        assert!(matches!(validate_password("short"), Err(AuthError::WeakPassword(_))));
    }

    #[test]
    fn password_too_long() {
        let long = "a".repeat(129);
        assert!(matches!(validate_password(&long), Err(AuthError::WeakPassword(_))));
    }

    #[test]
    fn weak_password_rejected() {
        for &weak in WEAK_PASSWORDS {
            assert!(validate_password(weak).is_err(), "expected rejection for: {weak}");
        }
    }

    #[test]
    fn weak_password_case_insensitive() {
        assert!(validate_password("PASSWORD").is_err());
        assert!(validate_password("Password").is_err());
    }

    // --- Username validation ---

    #[test]
    fn valid_username() {
        assert!(validate_username("test_user-1").is_ok());
    }

    #[test]
    fn valid_username_cjk() {
        assert!(validate_username("极客张军波").is_ok());
        assert!(validate_username("测试用户A-1").is_ok());
    }

    #[test]
    fn username_alphanumeric_only() {
        assert!(validate_username("abc123").is_ok());
    }

    #[test]
    fn username_exactly_min_length() {
        assert!(validate_username("abc").is_ok());
    }

    #[test]
    fn username_exactly_max_length() {
        let max = "a".repeat(32);
        assert!(validate_username(&max).is_ok());
    }

    #[test]
    fn username_too_short() {
        assert!(matches!(validate_username("ab"), Err(AuthError::InvalidUsername(_))));
    }

    #[test]
    fn username_too_long() {
        let long = "a".repeat(33);
        assert!(matches!(validate_username(&long), Err(AuthError::InvalidUsername(_))));
    }

    #[test]
    fn username_invalid_chars() {
        assert!(validate_username("test@user").is_err());
        assert!(validate_username("test user").is_err());
        assert!(validate_username("test.user").is_err());
    }

    #[test]
    fn username_starts_with_hyphen() {
        assert!(validate_username("-test").is_err());
    }

    #[test]
    fn username_starts_with_underscore() {
        assert!(validate_username("_test").is_err());
    }

    #[test]
    fn username_ends_with_hyphen() {
        assert!(validate_username("test-").is_err());
    }

    #[test]
    fn username_ends_with_underscore() {
        assert!(validate_username("test_").is_err());
    }

    #[test]
    fn username_hyphen_in_middle() {
        assert!(validate_username("test-user").is_ok());
    }

    #[test]
    fn username_underscore_in_middle() {
        assert!(validate_username("test_user").is_ok());
    }
}
