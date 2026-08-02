# Contributing to FoxLock Protocol

Thank you for your interest in contributing to FoxLock Protocol! This project is part of the Stellar Wave Program on Drips and actively welcomes contributors.

---

## Getting Started

1. **Fork** the repository
2. **Clone** your fork locally
3. **Install prerequisites:**
   - Rust: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
   - WASM target: `rustup target add wasm32v1-none`
   - Stellar CLI: `cargo install --locked stellar-cli`
4. **Build contracts:** `stellar contract build`
5. **Run tests:** `cargo test`

---

## How to Contribute

### Pick an Issue
- Browse [open issues](https://github.com/vaultfox-protocol/foxlock-protocol/issues)
- Comment on the issue to express interest before starting
- Wait for assignment confirmation

### Submit a Pull Request
- Create a branch: `git checkout -b feat/your-feature`
- Write clean, well-commented code
- Add tests for new functionality
- Run `cargo test` before submitting
- Open a PR with a clear description

### Code Standards
- All Rust code must pass `cargo clippy`
- No `unsafe` blocks
- Every public function must have a doc comment
- Tests required for all new contract logic

---

## Issue Complexity Levels

| Label | Points | Description |
|---|---|---|
| `complexity:low` | 15 pts | Small bug fixes, docs |
| `complexity:medium` | 40 pts | Standard features |
| `complexity:high` | 80 pts | Complex integrations |

---

## Need Help?

Open a GitHub Discussion or comment on the relevant issue.
We respond to all PRs within 48 hours.
