# Architecture Overview

## Contract Design

FoxLock Protocol consists of two Soroban smart contracts:

### 1. Escrow Contract
Handles milestone-based fund locking and release.

```
Client deposits funds
       ↓
Contributor submits milestone proof
       ↓
Client approves → funds released to contributor
Client rejects  → contributor resubmits
       ↓
Dispute? → Arbitrator splits remaining funds
Deadline passed? → Contributor claims automatically
```

### 2. Reputation Contract
Tracks FoxPoints and contributor tiers on-chain.

```
Milestone approved → Operator awards FoxPoints
       ↓
Points accumulate → Tier upgrades automatically
Cub (0) → Fox (100) → Senior (500) → Elite (2000)
```

## Storage Design

All data uses Soroban persistent storage with 30-day TTL bumps.
Instance storage holds counters and config.
Persistent storage holds escrow records keyed by ID.

## Security Model

- Client controls fund release
- Arbitrator resolves disputes
- Deadline prevents permanent fund lockup
- All transfers require require_auth()
