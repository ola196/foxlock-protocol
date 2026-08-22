/**
 * @foxlock/escrow-sdk
 *
 * Typed TypeScript SDK for the FoxLock milestone escrow contract on Stellar Soroban.
 *
 * @example
 * ```ts
 * import { EscrowClient, EscrowContractError } from "@foxlock/escrow-sdk";
 *
 * const client = new EscrowClient({
 *   contractId: "CCQ7CUG4NZ6QSAG62OMCVYWXVPXJMBJF2WCA6WJRBZ3YOQ4K2DWN5RHV",
 *   rpcUrl: "https://soroban-testnet.stellar.org",
 * });
 *
 * const escrow = await client.getEscrow(1n);
 * console.log(escrow.status); // "Active"
 * ```
 */

// Main client
export { EscrowClient } from "./client.js";

// All TypeScript types
export type {
  AcceptDeadlineExtensionParams,
  ApproveMilestoneParams,
  CancelEscrowParams,
  ClaimAfterDeadlineParams,
  CreateEscrowParams,
  EscrowClientConfig,
  EscrowRecord,
  EscrowStatus,
  Milestone,
  MilestoneInput,
  MilestoneStatus,
  PreparedTransaction,
  ProposeDeadlineExtensionParams,
  RaiseDisputeParams,
  RejectMilestoneParams,
  ResolveDisputeParams,
  SubmitMilestoneParams,
  TransactionResult,
} from "./types.js";

// Codec utilities — useful for advanced consumers who build their own transactions
export {
  decodeAddress,
  decodeEscrowRecord,
  decodeEscrowStatus,
  decodeI128,
  decodeMilestone,
  decodeMilestones,
  decodeMilestoneStatus,
  decodeResult,
  decodeString,
  decodeU32,
  decodeU64,
  encodeAddress,
  encodeI128,
  encodeMilestones,
  encodeString,
  encodeU32,
  encodeU64,
  ESCROW_ERROR_CODES,
  EscrowContractError,
} from "./codec.js";
