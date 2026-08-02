# FoxLock CLI

Command-line tool for interacting with FoxLock Protocol escrow and reputation contracts on Stellar.

## Installation

```bash
cd cli
npm install
```

## Setup

```bash
cp .env.example .env
# Set your STELLAR_OPERATOR_SECRET for signing transactions
```

## Usage

```bash
# Show network info and deployed contract IDs
node src/index.js network info

# View escrow details
node src/index.js escrow info --id 1

# Check unreleased balance
node src/index.js escrow balance --id 1

# Get total escrow count
node src/index.js escrow count

# Submit milestone proof (contributor)
node src/index.js milestone submit --escrow 1 --index 0 --proof "ipfs://Qm..."

# Approve a milestone (client)
node src/index.js milestone approve --escrow 1 --index 0

# Reject a milestone (client)
node src/index.js milestone reject --escrow 1 --index 0

# Get contributor reputation
node src/index.js reputation get --address G...

# Get just the tier
node src/index.js reputation tier --address G...
```

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `STELLAR_NETWORK` | `testnet` or `mainnet` | `testnet` |
| `STELLAR_RPC_URL` | Soroban RPC endpoint | testnet RPC |
| `STELLAR_OPERATOR_SECRET` | Secret key for signing (S...) | required for writes |
| `ESCROW_CONTRACT_ID` | Deployed escrow contract | testnet default |
| `REPUTATION_CONTRACT_ID` | Deployed reputation contract | testnet default |

## Commands

| Command | Description |
|---|---|
| `network info` | Show network + contract IDs |
| `escrow info --id` | View full escrow record |
| `escrow balance --id` | Check unreleased balance |
| `escrow count` | Total escrows created |
| `milestone submit` | Submit milestone proof |
| `milestone approve` | Approve + release funds |
| `milestone reject` | Reject for resubmission |
| `reputation get` | Full contributor profile |
| `reputation tier` | Quick tier lookup |
