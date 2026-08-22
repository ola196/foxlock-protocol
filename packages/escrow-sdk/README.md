# @foxlock/escrow-sdk

Typed TypeScript SDK for the **FoxLock milestone escrow contract** on Stellar Soroban.

- Full TypeScript types mirroring every on-chain Rust struct and enum
- Two-step transaction flow: build → sign → submit (wallet-agnostic)
- Typed read-only queries for `get_escrow`, `get_balance`, `get_escrow_count`
- ScVal encode/decode utilities exported for advanced consumers
- Works in Node.js, browsers, and Next.js (App Router)

---

## Installation

```bash
npm install @foxlock/escrow-sdk @stellar/stellar-sdk
```

`@stellar/stellar-sdk` is a peer dependency — install it alongside this package.

---

## Quick Start

```ts
import { EscrowClient } from "@foxlock/escrow-sdk";

const client = new EscrowClient({
  contractId: "CCQ7CUG4NZ6QSAG62OMCVYWXVPXJMBJF2WCA6WJRBZ3YOQ4K2DWN5RHV",
  rpcUrl: "https://soroban-testnet.stellar.org",
});

// Read-only query — no wallet needed
const escrow = await client.getEscrow(1n);
console.log(escrow.status);         // "Active"
console.log(escrow.totalAmount);    // 10000000n (base units)
console.log(escrow.milestones[0]);  // { title: "...", amount: ..., status: "Pending", proofUrl: "" }

const balance = await client.getBalance(1n);
console.log(balance); // unreleased amount in base units
```

---

## Transaction Flow

State-changing contract calls use a build → sign → submit pattern so that
this SDK remains wallet-agnostic. Your wallet handles signing; this SDK
handles everything else.

```ts
import { EscrowClient } from "@foxlock/escrow-sdk";

const client = new EscrowClient({ contractId: "C..." });

// 1. Build and simulate — returns the prepared XDR
const prepared = await client.createEscrow({
  client:         "GABC...CLIENT",
  contributor:    "GDEF...CONTRIB",
  arbitrator:     "GHIJ...ARB",
  token:          "CDLZ...USDC",
  deadlineLedger: 5_500_000,
  description:    "GrantFox bounty #42",
  milestones: [
    { title: "Backend API",  amount: 5_000_000_0n }, // 50 USDC (7 decimals)
    { title: "Frontend UI",  amount: 5_000_000_0n },
  ],
  // Optional: milestones cannot be submitted before ledger 5_100_000
  cliffLedger: 5_100_000,
});

// 2. Sign with your wallet (Freighter, StellarWalletsKit, etc.)
const signed = await wallet.signTransaction(prepared.xdr);

// 3. Submit and wait for confirmation
const result = await client.submit(signed);
console.log("Escrow ID:", result.returnValue); // e.g. 1n
console.log("TX Hash:", result.hash);
```

---

## API Reference

### `new EscrowClient(config)`

```ts
interface EscrowClientConfig {
  contractId: string;           // Deployed escrow contract address (C...)
  rpcUrl?: string;              // Soroban RPC URL (default: Testnet)
  networkPassphrase?: string;   // Network passphrase (default: Testnet)
}
```

---

### State-changing methods

All return `Promise<PreparedTransaction>`. Sign the `.xdr` field and call `client.submit(signed)`.

| Method | Signer | Contract function |
|---|---|---|
| `createEscrow(params)` | client | `create_escrow` |
| `submitMilestone(params)` | contributor | `submit_milestone` |
| `approveMilestone(params)` | client | `approve_milestone` |
| `rejectMilestone(params)` | client | `reject_milestone` |
| `raiseDispute(params)` | client or contributor | `raise_dispute` |
| `resolveDispute(params)` | arbitrator | `resolve_dispute` |
| `cancelEscrow(params)` | client | `cancel_escrow` |
| `claimAfterDeadline(params)` | contributor | `claim_after_deadline` |
| `proposeDeadlineExtension(params)` | client or contributor | `propose_deadline_extension` |
| `acceptDeadlineExtension(params)` | the other party | `accept_deadline_extension` |

---

### Read-only queries

No signing needed. Resolve directly.

```ts
// Full escrow record
const escrow: EscrowRecord = await client.getEscrow(1n);

// Unreleased balance in base units
const balance: bigint = await client.getBalance(1n);

// Total escrows ever created
const count: bigint = await client.getEscrowCount();
```

---

### `client.submit(signedXdr)`

Broadcasts a signed transaction and polls until confirmed.

```ts
const result: TransactionResult = await client.submit(signedXdr);
// result.hash    — transaction hash
// result.ledger  — ledger number
// result.returnValue — raw ScVal return from the contract (if any)
```

---

## Types

All types are exported and fully documented:

```ts
import type {
  EscrowRecord,
  Milestone,
  EscrowStatus,      // "Active" | "Completed" | "Disputed" | "Cancelled"
  MilestoneStatus,   // "Pending" | "Submitted" | "Approved" | "Rejected"
  CreateEscrowParams,
  SubmitMilestoneParams,
  PreparedTransaction,
  TransactionResult,
} from "@foxlock/escrow-sdk";
```

---

## Error Handling

Contract errors are thrown as `EscrowContractError`:

```ts
import { EscrowContractError, ESCROW_ERROR_CODES } from "@foxlock/escrow-sdk";

try {
  await client.getEscrow(999n);
} catch (err) {
  if (err instanceof EscrowContractError) {
    console.log(err.code);               // 2
    console.log(err.contractErrorName);  // "NotFound"
  }
}
```

| Code | Name |
|---|---|
| 2 | NotFound |
| 3 | Unauthorized |
| 4 | InvalidStatus |
| 6 | InvalidMilestoneStatus |
| 9 | InvalidDeadline |
| 12 | DeadlineNotReached |
| 15 | DeadlineProposalNotFound |
| 16 | DeadlineProposalMismatch |
| 17 | CliffNotReached |

Full list in `ESCROW_ERROR_CODES`.

---

## Deployed Contracts (Testnet)

| Contract | ID |
|---|---|
| Escrow | `CCQ7CUG4NZ6QSAG62OMCVYWXVPXJMBJF2WCA6WJRBZ3YOQ4K2DWN5RHV` |

---

## License

Apache-2.0
