# FoxLock CLI

Command-line tool for interacting with FoxLock Protocol escrow and reputation contracts on Stellar.

Two interaction modes are available:

| Mode | How it works | When to use |
|---|---|---|
| **SDK commands** (`escrow`, `milestone`, `reputation`) | Builds + signs transactions via the JS `@stellar/stellar-sdk` | Scripting, CI, raw secret key |
| **stellar-cli wrapper** (`stellar`) | Shells out to the `stellar` binary | Power users with named keys, hardware wallets, interactive signing |

---

## Installation

```bash
cd cli
npm install
```

## Prerequisites

**SDK commands** — no extra tools required.

**stellar-cli wrapper commands** — requires the `stellar` binary:

```bash
# Install stellar-cli
cargo install --locked stellar-cli

# Create and fund a testnet key
stellar keys generate my-key --network testnet
stellar keys fund my-key --network testnet
```

---

## Setup

```bash
cp .env.example .env
# Edit .env — set at minimum STELLAR_OPERATOR_SECRET (SDK) or STELLAR_SOURCE_KEY (stellar-cli)
```

---

## SDK Commands

### Network

```bash
# Show network and contract info
node src/index.js network info
```

### Escrow (read-only)

```bash
# View full escrow record
node src/index.js escrow info --id 1

# Check unreleased balance
node src/index.js escrow balance --id 1

# Total escrows on-chain
node src/index.js escrow count
```

### Milestone (requires STELLAR_OPERATOR_SECRET)

```bash
# Submit milestone proof (contributor)
node src/index.js milestone submit --escrow 1 --index 0 --proof "ipfs://Qm..."

# Approve a milestone and release funds (client)
node src/index.js milestone approve --escrow 1 --index 0

# Reject a milestone (client)
node src/index.js milestone reject --escrow 1 --index 0
```

### Reputation (read-only)

```bash
# Full contributor profile
node src/index.js reputation get --address G...

# Quick tier lookup
node src/index.js reputation tier --address G...
```

---

## stellar-cli Wrapper Commands

These commands shell out to the `stellar` binary and use its key management,
so you can use named keys, hardware wallets, or any signer stellar-cli supports.

**Check your stellar-cli version:**
```bash
node src/index.js stellar version
```

### stellar create-escrow

Create a new escrow agreement on-chain.

```bash
node src/index.js stellar create-escrow \
  --contributor GCONTRIBUTOR... \
  --arbitrator  GARBITRATOR... \
  --token       CUSDC_CONTRACT_ID... \
  --deadline    1234567 \
  --description "Website redesign project" \
  --milestones  '[{"title":"Wireframes","amount":"5000000"},{"title":"Implementation","amount":"10000000"}]' \
  --source      my-key
```

**Options:**

| Flag | Required | Description |
|---|---|---|
| `--contributor <G...>` | ✓ | Stellar address of the contributor (worker) |
| `--arbitrator <G...>` | ✓ | Stellar address of the arbitrator |
| `--token <C...>` | ✓ | SEP-0041 token contract (e.g. USDC) |
| `--deadline <ledger>` | ✓ | Absolute ledger number for the expiry deadline |
| `--description <text>` | ✓ | Human-readable description |
| `--milestones <json>` | ✓ | JSON array — see format below |
| `--source <key>` | ✓* | Named key or raw secret — overrides `STELLAR_SOURCE_KEY` |
| `--network <name>` | — | Network alias (default: `STELLAR_NETWORK` env) |

**Milestones JSON format:**
```json
[
  { "title": "Wireframes",     "amount": "5000000"  },
  { "title": "Implementation", "amount": "10000000" }
]
```
Amount is in the token's base unit (stroops for XLM, 7-decimal for USDC).

**Output:**
```
✔ Escrow created!
Escrow ID: 3
```

---

### stellar submit-milestone

Submit proof of completion for a milestone (contributor).

```bash
node src/index.js stellar submit-milestone \
  --escrow 3 \
  --index  0 \
  --proof  "ipfs://QmXyz..." \
  --source my-key
```

| Flag | Required | Description |
|---|---|---|
| `--escrow <number>` | ✓ | On-chain escrow ID |
| `--index <number>` | ✓ | Milestone index (0-based) |
| `--proof <url>` | ✓ | IPFS CID or HTTPS URL with evidence |
| `--source <key>` | ✓* | Signing key (must be the contributor) |
| `--network <name>` | — | Network alias |

---

### stellar approve-milestone

Approve a submitted milestone and release its funds (client only).

```bash
node src/index.js stellar approve-milestone \
  --escrow 3 \
  --index  0 \
  --source my-key
```

| Flag | Required | Description |
|---|---|---|
| `--escrow <number>` | ✓ | On-chain escrow ID |
| `--index <number>` | ✓ | Milestone index (0-based) |
| `--source <key>` | ✓* | Signing key (must be the client) |
| `--network <name>` | — | Network alias |

---

### stellar check-balance

Check the unreleased token balance of an escrow (read-only, no signing required).

```bash
node src/index.js stellar check-balance --escrow 3
```

| Flag | Required | Description |
|---|---|---|
| `--escrow <number>` | ✓ | On-chain escrow ID |
| `--network <name>` | — | Network alias |

**Output:**
```
💰 Escrow #3 — Unreleased Balance
─────────────────────────────────────────────
Balance: 1.5 tokens
(raw i128: 15000000)
```

---

## Environment Variables

| Variable | Commands | Description | Default |
|---|---|---|---|
| `STELLAR_NETWORK` | all | `testnet` or `mainnet` | `testnet` |
| `STELLAR_RPC_URL` | all | Soroban RPC endpoint | testnet RPC |
| `STELLAR_OPERATOR_SECRET` | SDK write commands | Raw secret key (`S...`) | required |
| `STELLAR_SOURCE_KEY` | stellar wrapper | Named key or secret for signing | required |
| `ESCROW_CONTRACT_ID` | all | Deployed escrow contract | testnet default |
| `REPUTATION_CONTRACT_ID` | reputation | Deployed reputation contract | testnet default |

---

## Full Command Reference

| Command | Description |
|---|---|
| `network info` | Show network + contract IDs |
| `escrow info --id` | View full escrow record |
| `escrow balance --id` | Check unreleased balance |
| `escrow count` | Total escrows created |
| `milestone submit` | Submit milestone proof (SDK) |
| `milestone approve` | Approve + release funds (SDK) |
| `milestone reject` | Reject for resubmission (SDK) |
| `reputation get` | Full contributor profile |
| `reputation tier` | Quick tier lookup |
| `stellar create-escrow` | Create escrow via stellar-cli |
| `stellar submit-milestone` | Submit proof via stellar-cli |
| `stellar approve-milestone` | Approve + release via stellar-cli |
| `stellar check-balance` | Check balance via stellar-cli |
| `stellar version` | Show stellar-cli version |
