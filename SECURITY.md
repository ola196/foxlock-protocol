# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 0.1.x | ✅ |

## Reporting a Vulnerability

If you discover a security vulnerability in FoxLock Protocol, please do **not** open a public issue.

Instead, email: **foxchainlabs@gmail.com**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will respond within 48 hours and work with you to resolve the issue before any public disclosure.

## Security Practices

- All amounts validated before token transfers
- `require_auth()` on every state-changing function
- `overflow-checks = true` in release profile
- No `unsafe` code
- Max limits on signers and proposals to prevent DoS
