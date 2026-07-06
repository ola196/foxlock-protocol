# Soroban Milestone Escrow

A production-ready, trustless escrow protocol built on Stellar Soroban smart contracts.  
Designed for milestone-based fund release in Web3 collaboration platforms like **GrantFox**.

---

## Why This Exists

The Web3 ecosystem needs a standard, open-source escrow primitive that:

- Releases funds **incrementally** as milestones are completed and approved
- Provides **on-chain dispute resolution** via a trusted arbitrator
- Prevents funds from being locked forever with a **deadline-based escape hatch**
- Builds contributor **reputation on-chain** — transparent and verifiable

This project fills that gap for the Stellar ecosystem using Soroban smart contracts.

---

## Architecture

```
soroban-milestone-escrow/
├── contracts/
│   ├── escrow/          # Core escrow logic (Rust/Soroban)
│   │   └── src/
│   │       ├── contract.rs   # Main contract impl
│   │       ├── types.rs      # EscrowRecord, Milestone, Status enums
│   │       ├── errors.rs     # EscrowError codes
│   │       ├── events.rs     # On-chain events for indexers
│   │       ├── storage.rs    # Storage helpers + TTL management
│   │       └── tests/        # Unit + integration tests
│   └── reputation/      # FoxPoints & tier tracking (Rust/Soroban)
│       └── src/
│           ├── contract.rs
│           ├── types.rs      # ContributorProfile, Tier enum
│           ├── errors.rs
│           └── storage.rs
├── frontend/            # Next.js 15 + TypeScript dApp
│   └── src/
│       ├── app/         # App Router pages
│       ├── components/  # Shared UI components
│       ├── lib/         # Stellar SDK + wallet helpers
│       └── store/       # Zustand global state
└── scripts/
    └── deploy.sh        # Build + deploy to Stellar Testnet
```

---

## Deployed Contracts (Stellar Testnet)

| Contract | Contract ID |
|---|---|
| Escrow | `CCQ7CUG4NZ6QSAG62OMCVYWXVPXJMBJF2WCA6WJRBZ3YOQ4K2DWN5RHV` |
| Reputation | `CD2VIBP7TYVGW6NRFIM4WKUQDNUIIT2UB66CPF7K77DOO2WOMO4KB7U4` |

🔍 Verify live on Stellar Expert:
- [Escrow Contract](https://stellar.expert/explorer/testnet/contract/CCQ7CUG4NZ6QSAG62OMCVYWXVPXJMBJF2WCA6WJRBZ3YOQ4K2DWN5RHV)
- [Reputation Contract](https://stellar.expert/explorer/testnet/contract/CD2VIBP7TYVGW6NRFIM4WKUQDNUIIT2UB66CPF7K77DOO2WOMO4KB7U4)

---

## Smart Contract Design

### Escrow Contract

| Function | Who Calls It | What It Does |
|---|---|---|
| `create_escrow` | Client | Locks funds, defines milestones |
| `submit_milestone` | Contributor | Submits proof of completion |
| `approve_milestone` | Client | Releases milestone funds |
| `reject_milestone` | Client | Returns milestone to Pending |
| `raise_dispute` | Client or Contributor | Freezes escrow |
| `resolve_dispute` | Arbitrator | Splits remaining funds |
| `cancel_escrow` | Client | Refunds if no work started |
| `claim_after_deadline` | Contributor | Claims if client is inactive |
| `get_escrow` | Anyone | Read-only query |

### Reputation Contract

| Function | Who Calls It | What It Does |
|---|---|---|
| `initialize` | Deployer | Sets authorized operator |
| `award_points` | Operator | Awards FoxPoints after approval |
| `record_rejection` | Operator | Logs a rejection (quality signal) |
| `get_profile` | Anyone | Returns full ContributorProfile |
| `get_tier` | Anyone | Returns just the Tier enum |

### Tier System

| Tier | Min FoxPoints | Issue Cap | 
|---|---|---|
| Cub | 0 | 3/campaign |
| Fox | 100 | 5/campaign |
| Senior | 500 | 10/campaign |
| Elite | 2,000 | Unlimited |

---

## Security Highlights

- `require_auth()` on every state-changing call — no unsigned calls succeed
- `overflow-checks = true` in Cargo profile — arithmetic overflows panic, not wrap
- Milestone amounts validated to be positive; total validated at creation
- Maximum 20 milestones per escrow (DoS prevention)
- Cancellation blocked if any milestone is submitted/approved (protects contributor)
- Dispute resolution requires exact split (client + contributor = remaining balance)
- Storage TTLs maintained to prevent expiry of live escrows
- No `unsafe` code

---

## Getting Started

### Prerequisites

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install stellar-cli
cargo install --locked stellar-cli

# Install wasm target
rustup target add wasm32v1-none
```

### Build contracts

```bash
cd soroban-milestone-escrow
stellar contract build
```

### Run tests

```bash
cargo test
```

### Deploy to Testnet

```bash
# Generate a keypair and fund it
stellar keys generate my-key --network testnet
stellar keys fund my-key --network testnet

# Deploy both contracts + generate TS bindings
DEPLOYER_KEY=my-key ./scripts/deploy.sh
```

### Run the frontend

```bash
cd frontend
npm install
npm run dev
# Open http://localhost:3000
```

---

## Frontend

Built with:
- **Next.js 15** (App Router)
- **TypeScript** (strict mode)
- **Tailwind CSS v3**
- **@stellar/stellar-sdk** for contract interaction
- **stellar-wallets-kit** for Freighter + multi-wallet support
- **Zustand** for wallet state

Key pages:
- `/` — Overview and entry points
- `/escrow/create` — Create a new escrow agreement
- `/escrow/[id]` — View and interact with an escrow
- `/reputation` — Look up contributor FoxPoints and tier

---

## Contributing

This project follows the GrantFox OSS contribution guidelines.

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Write tests for your changes
4. Run `cargo test` and `npm run type-check` before submitting
5. Open a PR with a clear description of the problem and solution

---

## License

Apache 2.0 — same as the Stellar ecosystem.

---

## Acknowledgments

Built as an OSS contribution to the GrantFox / GrantChain ecosystem.  
Inspired by Trustless Work and the Stellar Soroban example contracts.
