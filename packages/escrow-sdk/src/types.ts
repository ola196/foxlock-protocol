/**
 * @foxlock/escrow-sdk — TypeScript types mirroring the on-chain Rust structs.
 *
 * Every type here maps 1-to-1 with a Soroban `#[contracttype]` in
 * contracts/escrow/src/types.rs. Keep them in sync when the contract changes.
 */

// ── Enums ─────────────────────────────────────────────────────────────────────

/** Top-level status of an escrow agreement. Maps to `EscrowStatus` on-chain. */
export type EscrowStatus =
  | "Active"
  | "Completed"
  | "Disputed"
  | "Cancelled";

/** Status of an individual milestone. Maps to `MilestoneStatus` on-chain. */
export type MilestoneStatus =
  | "Pending"
  | "Submitted"
  | "Approved"
  | "Rejected";

// ── Structs ───────────────────────────────────────────────────────────────────

/**
 * A single milestone within an escrow agreement.
 * Maps to `Milestone` on-chain.
 */
export interface Milestone {
  /** Human-readable title, e.g. "Backend API complete" */
  title: string;
  /**
   * Token amount allocated to this milestone, in base units (stroops for XLM,
   * or 10^7 units for USDC on Stellar).
   */
  amount: bigint;
  /** Current lifecycle status of this milestone. */
  status: MilestoneStatus;
  /** IPFS CID or URL pointing to proof of work (empty string when not yet submitted). */
  proofUrl: string;
}

/**
 * The full escrow record returned by `get_escrow`.
 * Maps to `EscrowRecord` on-chain.
 */
export interface EscrowRecord {
  /** Stellar address of the party funding the escrow (project / client). */
  client: string;
  /** Stellar address of the party doing the work (contributor / service provider). */
  contributor: string;
  /** Stellar address of the trusted dispute arbitrator. */
  arbitrator: string;
  /** SEP-0041 token contract address used for payment (e.g. USDC). */
  token: string;
  /** Total amount deposited into this escrow (base units). */
  totalAmount: bigint;
  /** Amount already released to the contributor (base units). */
  releasedAmount: bigint;
  /** Ordered list of milestones. */
  milestones: Milestone[];
  /**
   * Ledger number after which the contributor may call `claim_after_deadline`
   * without the client's approval.
   */
  deadlineLedger: number;
  /** Current status of the escrow. */
  status: EscrowStatus;
  /** Optional human-readable description of the escrow. */
  description: string;
  /**
   * Earliest ledger at which milestones may be submitted.
   * `0` means no cliff is set (submissions allowed immediately after creation).
   */
  cliffLedger: number;
}

// ── Input types ───────────────────────────────────────────────────────────────

/**
 * Arguments for `create_escrow`.
 * `cliff_ledger` is optional — omit or pass `0` to disable.
 */
export interface CreateEscrowParams {
  /** Funding party. Must be the transaction signer. */
  client: string;
  contributor: string;
  arbitrator: string;
  /** SEP-0041 token contract address. */
  token: string;
  milestones: MilestoneInput[];
  /**
   * Ledger number after which the contributor can claim without approval.
   * Must be in the future at the time of creation.
   */
  deadlineLedger: number;
  /** Optional description stored on-chain. Defaults to "". */
  description?: string;
  /**
   * Optional cliff ledger. Milestones cannot be submitted before this ledger.
   * `0` or omitted = no cliff.
   */
  cliffLedger?: number;
}

/**
 * Milestone definition for `create_escrow`.
 * Status and proofUrl are set automatically (Pending / "").
 */
export interface MilestoneInput {
  title: string;
  /** Amount in token base units (e.g. multiply USD amount by 1e7 for USDC). */
  amount: bigint;
}

/** Arguments for `submit_milestone`. */
export interface SubmitMilestoneParams {
  /** Must match the escrow's contributor. Transaction must be signed by this address. */
  contributor: string;
  escrowId: bigint;
  milestoneIndex: number;
  /** IPFS CID or URL pointing to proof of work. */
  proofUrl: string;
}

/** Arguments for `approve_milestone`. */
export interface ApproveMilestoneParams {
  /** Must match the escrow's client. Transaction must be signed by this address. */
  client: string;
  escrowId: bigint;
  milestoneIndex: number;
}

/** Arguments for `reject_milestone`. */
export interface RejectMilestoneParams {
  client: string;
  escrowId: bigint;
  milestoneIndex: number;
}

/** Arguments for `raise_dispute`. */
export interface RaiseDisputeParams {
  /** Either client or contributor. */
  caller: string;
  escrowId: bigint;
}

/** Arguments for `resolve_dispute`. */
export interface ResolveDisputeParams {
  arbitrator: string;
  escrowId: bigint;
  /** Amount to return to the client (base units). */
  clientAmount: bigint;
  /** Amount to release to the contributor (base units). */
  contributorAmount: bigint;
}

/** Arguments for `cancel_escrow`. */
export interface CancelEscrowParams {
  client: string;
  escrowId: bigint;
}

/** Arguments for `claim_after_deadline`. */
export interface ClaimAfterDeadlineParams {
  contributor: string;
  escrowId: bigint;
}

/** Arguments for `propose_deadline_extension`. */
export interface ProposeDeadlineExtensionParams {
  /** Client or contributor. */
  caller: string;
  escrowId: bigint;
  newDeadline: number;
}

/** Arguments for `accept_deadline_extension`. */
export interface AcceptDeadlineExtensionParams {
  /** Must be the party who did NOT make the proposal. */
  caller: string;
  escrowId: bigint;
  /** Must match the pending proposal exactly. */
  newDeadline: number;
}

// ── Result types ──────────────────────────────────────────────────────────────

/**
 * Returned by all state-changing methods that produce a transaction.
 *
 * The SDK builds and simulates the transaction on your behalf, then
 * returns the prepared XDR. You sign it with your wallet and pass the
 * signed XDR to `EscrowClient.submit()`.
 */
export interface PreparedTransaction {
  /** Base64-encoded XDR of the assembled, fee-bumped transaction. Ready to sign. */
  xdr: string;
  /** Estimated fee in stroops (for display / fee-bump purposes). */
  fee: string;
}

/**
 * Returned after a signed transaction has been submitted and confirmed.
 */
export interface TransactionResult {
  /** Transaction hash. */
  hash: string;
  /** Ledger number in which the transaction was included. */
  ledger: number;
  /** Raw ScVal return value from the contract (if any). */
  returnValue?: unknown;
}

// ── Config ────────────────────────────────────────────────────────────────────

/** Configuration passed to `EscrowClient`. */
export interface EscrowClientConfig {
  /** Soroban RPC endpoint. Defaults to Testnet. */
  rpcUrl?: string;
  /** Stellar network passphrase. Defaults to Testnet. */
  networkPassphrase?: string;
  /** Deployed escrow contract ID (C...). */
  contractId: string;
}
