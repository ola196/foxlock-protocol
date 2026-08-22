/**
 * @foxlock/escrow-sdk — ScVal encode/decode utilities.
 *
 * All on-chain types are encoded as XDR ScVal before being sent to the
 * Soroban RPC, and decoded from ScVal in query responses.
 *
 * Encoding functions (JS → ScVal):
 *   encodeAddress, encodeU64, encodeU32, encodeI128, encodeString,
 *   encodeMilestones
 *
 * Decoding functions (ScVal → JS):
 *   decodeEscrowRecord, decodeMilestones, decodeMilestone,
 *   decodeI128, decodeU64, decodeString, decodeEscrowStatus,
 *   decodeMilestoneStatus
 */

import {
  Address,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import type {
  EscrowRecord,
  EscrowStatus,
  Milestone,
  MilestoneInput,
  MilestoneStatus,
} from "./types.js";

// ── Encoding (JS → ScVal) ─────────────────────────────────────────────────────

/** Encode a Stellar address (G... or C...) as ScVal Address. */
export function encodeAddress(addr: string): xdr.ScVal {
  return new Address(addr).toScVal();
}

/** Encode a number or bigint as u64 ScVal. */
export function encodeU64(n: bigint | number): xdr.ScVal {
  return xdr.ScVal.scvU64(xdr.Uint64.fromString(n.toString()));
}

/** Encode a number as u32 ScVal. */
export function encodeU32(n: number): xdr.ScVal {
  return xdr.ScVal.scvU32(n);
}

/** Encode a bigint as i128 ScVal. */
export function encodeI128(n: bigint): xdr.ScVal {
  return nativeToScVal(n, { type: "i128" });
}

/** Encode a JS string as ScVal String (UTF-8 bytes). */
export function encodeString(s: string): xdr.ScVal {
  return xdr.ScVal.scvString(s);
}

/**
 * Encode an array of MilestoneInput objects as a Soroban Vec<Milestone>.
 *
 * Each Milestone struct on-chain has four fields in declaration order:
 *   { title: String, amount: i128, status: MilestoneStatus, proof_url: String }
 *
 * Status is always `Pending` and proof_url always `""` at creation time,
 * matching the contract invariant checked in `create_escrow`.
 */
export function encodeMilestones(milestones: MilestoneInput[]): xdr.ScVal {
  const encoded = milestones.map((m) =>
    xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("title"),
        val: encodeString(m.title),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("amount"),
        val: encodeI128(m.amount),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("status"),
        // MilestoneStatus::Pending — Soroban encodes enum variants as a
        // single-element Vec<Symbol>: scvVec([scvSymbol("Pending")])
        val: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Pending")]),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("proof_url"),
        val: encodeString(""),
      }),
    ])
  );
  return xdr.ScVal.scvVec(encoded);
}

// ── Decoding (ScVal → JS) ─────────────────────────────────────────────────────

/**
 * Decode a signed i128 ScVal to a JavaScript BigInt.
 *
 * i128 is stored as two signed/unsigned 64-bit halves:
 *   value = (hi << 64n) | lo   (lo is treated as unsigned)
 */
export function decodeI128(val: xdr.ScVal): bigint {
  const parts = val.i128();
  const hi = BigInt(parts.hi().toString()); // Int64 — signed
  const lo = BigInt(parts.lo().toString()); // Uint64 — unsigned
  return (hi << 64n) | lo;
}

/** Decode a u64 ScVal to a BigInt. */
export function decodeU64(val: xdr.ScVal): bigint {
  return BigInt(val.u64().toString());
}

/** Decode a u32 ScVal to a number. */
export function decodeU32(val: xdr.ScVal): number {
  return val.u32();
}

/** Decode a ScVal String or Symbol to a JS string. */
export function decodeString(val: xdr.ScVal): string {
  const type = val.switch().name;
  if (type === "scvString") return val.str().toString();
  if (type === "scvSymbol") return val.sym().toString();
  throw new Error(`Expected scvString or scvSymbol, got ${type}`);
}

/** Decode a Soroban Address ScVal to a Stellar address string. */
export function decodeAddress(val: xdr.ScVal): string {
  return Address.fromScVal(val).toString();
}

/**
 * Decode an enum variant ScVal to its string name.
 *
 * Soroban encodes enum variants as scvVec([scvSymbol("VariantName")]).
 */
function decodeEnumVariant(val: xdr.ScVal): string {
  if (val.switch().name === "scvVec") {
    const vec = val.vec();
    if (vec && vec.length > 0) {
      const first = vec[0];
      if (first !== undefined && first.switch().name === "scvSymbol") {
        return first.sym().toString();
      }
    }
  }
  // Fallback: sometimes encoded as plain symbol
  if (val.switch().name === "scvSymbol") {
    return val.sym().toString();
  }
  throw new Error(`Cannot decode enum variant from ${val.switch().name}`);
}

/** Decode a MilestoneStatus ScVal. */
export function decodeMilestoneStatus(val: xdr.ScVal): MilestoneStatus {
  const name = decodeEnumVariant(val);
  switch (name) {
    case "Pending":    return "Pending";
    case "Submitted":  return "Submitted";
    case "Approved":   return "Approved";
    case "Rejected":   return "Rejected";
    default:           throw new Error(`Unknown MilestoneStatus: ${name}`);
  }
}

/** Decode an EscrowStatus ScVal. */
export function decodeEscrowStatus(val: xdr.ScVal): EscrowStatus {
  const name = decodeEnumVariant(val);
  switch (name) {
    case "Active":     return "Active";
    case "Completed":  return "Completed";
    case "Disputed":   return "Disputed";
    case "Cancelled":  return "Cancelled";
    default:           throw new Error(`Unknown EscrowStatus: ${name}`);
  }
}

/**
 * Decode a single Milestone from a ScVal Map.
 *
 * Expected field order (as stored by Soroban):
 *   title, amount, status, proof_url
 */
export function decodeMilestone(val: xdr.ScVal): Milestone {
  const map = val.map();
  if (!map) throw new Error("Expected scvMap for Milestone");

  const fields: Record<string, xdr.ScVal> = {};
  for (const entry of map) {
    const key = entry.key().sym?.() ?? entry.key().str?.();
    if (key) fields[key.toString()] = entry.val();
  }

  const title     = fields["title"]     !== undefined ? decodeString(fields["title"])                : (() => { throw new Error("Milestone missing title"); })();
  const amount    = fields["amount"]    !== undefined ? decodeI128(fields["amount"])                 : (() => { throw new Error("Milestone missing amount"); })();
  const status    = fields["status"]    !== undefined ? decodeMilestoneStatus(fields["status"])      : (() => { throw new Error("Milestone missing status"); })();
  const proofUrl  = fields["proof_url"] !== undefined ? decodeString(fields["proof_url"])            : (() => { throw new Error("Milestone missing proof_url"); })();

  return { title, amount, status, proofUrl };
}

/**
 * Decode a Vec<Milestone> ScVal into an array of Milestone objects.
 */
export function decodeMilestones(val: xdr.ScVal): Milestone[] {
  const vec = val.vec();
  if (!vec) throw new Error("Expected scvVec for milestones");
  return vec.map(decodeMilestone);
}

/**
 * Decode the full EscrowRecord returned by `get_escrow`.
 *
 * Expects the top-level ScVal to be a scvMap with keys matching the
 * Rust struct field names (snake_case, as Soroban serialises them).
 */
export function decodeEscrowRecord(val: xdr.ScVal): EscrowRecord {
  const map = val.map();
  if (!map) throw new Error("Expected scvMap for EscrowRecord");

  const fields: Record<string, xdr.ScVal> = {};
  for (const entry of map) {
    const key = entry.key().sym?.() ?? entry.key().str?.();
    if (key) fields[key.toString()] = entry.val();
  }

  const get = (name: string): xdr.ScVal => {
    const v = fields[name];
    if (v === undefined) throw new Error(`EscrowRecord missing field: ${name}`);
    return v;
  };

  return {
    client:          decodeAddress(get("client")),
    contributor:     decodeAddress(get("contributor")),
    arbitrator:      decodeAddress(get("arbitrator")),
    token:           decodeAddress(get("token")),
    totalAmount:     decodeI128(get("total_amount")),
    releasedAmount:  decodeI128(get("released_amount")),
    milestones:      decodeMilestones(get("milestones")),
    deadlineLedger:  decodeU32(get("deadline_ledger")),
    status:          decodeEscrowStatus(get("status")),
    description:     decodeString(get("description")),
    cliffLedger:     decodeU32(get("cliff_ledger")),
  };
}

/**
 * Decode a Result<T, EscrowError> ScVal.
 *
 * Soroban wraps contract return values in a Result discriminant when errors
 * are possible. This unwraps the Ok variant or throws a descriptive error.
 *
 * @param val     - The raw ScVal from the RPC simulation result
 * @param decode  - Decoder for the Ok inner value
 */
export function decodeResult<T>(
  val: xdr.ScVal,
  decode: (inner: xdr.ScVal) => T
): T {
  const type = val.switch().name;

  // Success path: scvVec([scvSymbol("Ok"), <value>]) or just <value> when
  // the contract is invoked via sendTransaction (result is unwrapped by host)
  if (type !== "scvVec") {
    // Directly returned (non-result wrapping)
    return decode(val);
  }

  const vec = val.vec();
  if (!vec || vec.length === 0) throw new Error("Empty result vec");

  const discriminant = vec[0];
  if (discriminant === undefined) throw new Error("Missing result discriminant");

  const tag = discriminant.switch().name === "scvSymbol"
    ? discriminant.sym().toString()
    : "";

  if (tag === "Ok") {
    const inner = vec[1];
    if (inner === undefined) throw new Error("Result Ok missing inner value");
    return decode(inner);
  }

  if (tag === "Err") {
    const errVal = vec[1];
    const errCode = errVal?.switch().name === "scvU32"
      ? errVal.u32()
      : "unknown";
    throw new EscrowContractError(Number(errCode));
  }

  // Not a tagged result — decode directly
  return decode(val);
}

// ── Error ─────────────────────────────────────────────────────────────────────

/** Error codes matching `EscrowError` in contracts/escrow/src/errors.rs */
export const ESCROW_ERROR_CODES: Record<number, string> = {
  1:  "AlreadyInitialized",
  2:  "NotFound",
  3:  "Unauthorized",
  4:  "InvalidStatus",
  5:  "InvalidMilestone",
  6:  "InvalidMilestoneStatus",
  7:  "AmountMismatch",
  8:  "InvalidAmount",
  9:  "InvalidDeadline",
  10: "EmptyMilestones",
  11: "TransferFailed",
  12: "DeadlineNotReached",
  13: "TooManyMilestones",
  14: "InvalidToken",
  15: "DeadlineProposalNotFound",
  16: "DeadlineProposalMismatch",
  17: "CliffNotReached",
};

/**
 * Error thrown when the escrow contract returns an error code.
 */
export class EscrowContractError extends Error {
  readonly code: number;
  readonly contractErrorName: string;

  constructor(code: number) {
    const name = ESCROW_ERROR_CODES[code] ?? `Unknown(${code})`;
    super(`EscrowContract error: ${name} (code ${code})`);
    this.name = "EscrowContractError";
    this.code = code;
    this.contractErrorName = name;
  }
}
