# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in Bonsai, please report it responsibly:

1. **Do NOT open a public issue** for security vulnerabilities
2. Email the maintainers directly or use GitHub's private vulnerability reporting
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will acknowledge receipt within 48 hours and provide a detailed response within 7 days.

## Security Model

### Local-First Architecture

Bonsai is a frontend-only application with no backend server:

- All conversation data is stored locally in IndexedDB
- No data is sent to any server except NanoGPT API calls
- The application can function offline (except for AI responses)

### Data Storage

| Data | Storage Location | Encryption |
|------|-----------------|------------|
| Conversations | IndexedDB | Optional (user-enabled) |
| Messages | IndexedDB | Optional (user-enabled) |
| API Key | localStorage | Optional (when encryption enabled) |
| Encryption metadata | localStorage | Salt + params only (no keys) |

### Optional Encryption

When enabled, Bonsai uses:
- **PBKDF2** for key derivation (100,000 iterations, SHA-256)
- **AES-GCM** for encryption (256-bit key, random IV per encryption)
- Session key stored in memory only (cleared on lock/refresh)

### Threat Model

Bonsai's encryption protects against:
- Casual inspection of browser storage
- Data exposure if device is shared
- Basic forensic analysis of stored data

Bonsai's encryption does NOT protect against:
- Compromised browser or extensions with storage access
- Malware with memory access while app is unlocked
- Physical access to unlocked, running application
- Network interception of API calls (use HTTPS)

### API Key Security

- API keys are stored locally and never logged
- Keys are only sent to NanoGPT's API endpoint
- When encryption is enabled, stored keys are encrypted

## Best Practices for Users

1. **Use encryption** if you store sensitive conversations
2. **Use a strong passphrase** (12+ characters recommended)
3. **Lock the app** when stepping away from your device
4. **Don't share screenshots** that might contain API keys or sensitive data
5. **Use HTTPS** when accessing the hosted version
6. **Review browser extensions** that might have storage access
