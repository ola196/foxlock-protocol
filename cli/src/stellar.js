import {
  rpc,
  TransactionBuilder,
  BASE_FEE,
  Contract,
  Keypair,
  nativeToScVal,
  Address,
  xdr,
} from "@stellar/stellar-sdk";
import { RPC_URL, NETWORK_PASSPHRASE } from "./config.js";

// stellar-sdk v13: SorobanRpc was renamed to `rpc`
const SorobanRpc = rpc;

export const server = new rpc.Server(RPC_URL, { allowHttp: false });

/**
 * Build, simulate, sign, and submit a contract call.
 * Polls until the transaction is confirmed or fails.
 *
 * @param {string}   secretKey  – Stellar secret key (S...)
 * @param {string}   contractId – Deployed contract address
 * @param {string}   method     – Contract function name
 * @param {xdr.ScVal[]} args   – Encoded ScVal arguments
 * @returns {{ txHash: string, result: object }}
 */
export async function invokeContract(secretKey, contractId, method, args) {
  const keypair = Keypair.fromSecret(secretKey);
  const account = await server.getAccount(keypair.publicKey());
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  const prepared = SorobanRpc.assembleTransaction(tx, simResult).build();
  prepared.sign(keypair);

  const sendResult = await server.sendTransaction(prepared);
  if (sendResult.status === "ERROR") {
    throw new Error(
      `Transaction error: ${JSON.stringify(sendResult.errorResult)}`
    );
  }

  // Poll for ledger confirmation (max ~30 s)
  let result = await server.getTransaction(sendResult.hash);
  let attempts = 0;
  while (
    result.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND &&
    attempts < 20
  ) {
    await new Promise((r) => setTimeout(r, 1500));
    result = await server.getTransaction(sendResult.hash);
    attempts++;
  }

  if (result.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Transaction failed with status: ${result.status}`);
  }

  return { txHash: sendResult.hash, result };
}

/**
 * Read-only contract query — uses a well-known funded account as fee source
 * so the caller does not need a secret key.
 *
 * @param {string}      contractId
 * @param {string}      method
 * @param {xdr.ScVal[]} args
 * @returns {xdr.ScVal | undefined}
 */
export async function queryContract(contractId, method, args) {
  // Friendbot-funded public key used only as fee-payer placeholder for sims.
  const DUMMY = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
  const account = await server.getAccount(DUMMY);
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Query failed: ${simResult.error}`);
  }

  return simResult.result?.retval;
}

// ── ScVal encoding helpers ────────────────────────────────────────────────────

/** Encode a Stellar address (G... or C...) as ScVal Address. */
export const toAddress = (addr) => new Address(addr).toScVal();

/** Encode a number as u64 ScVal. */
export const toU64 = (n) => nativeToScVal(BigInt(n), { type: "u64" });

/** Encode a number as u32 ScVal. */
export const toU32 = (n) => xdr.ScVal.scvU32(Number(n));

/** Encode a number as i128 ScVal. */
export const toI128 = (n) => nativeToScVal(BigInt(n), { type: "i128" });

/** Encode a JS string as ScVal String (UTF-8). */
export const toStr = (s) => xdr.ScVal.scvString(s);

/** Encode a JS string as ScVal Symbol. */
export const toSym = (s) => xdr.ScVal.scvSymbol(s);

// ── ScVal decoding helpers ────────────────────────────────────────────────────

/**
 * Convert a signed i128 ScVal to a JavaScript BigInt.
 *
 * The on-chain i128 is stored as two 64-bit halves:
 *   hi (signed) – upper 64 bits
 *   lo (unsigned) – lower 64 bits
 *
 * Value = (BigInt(hi) << 64n) | BigInt.asUintN(64, BigInt(lo))
 */
export function i128ToBigInt(scval) {
  const parts = scval.i128();
  const hi = BigInt(parts.hi().toString()); // Int64 → BigInt (signed)
  const lo = BigInt(parts.lo().toString()); // Uint64 → BigInt (unsigned)
  return (hi << 64n) | lo;
}

/**
 * Convert a u64 ScVal to a JavaScript BigInt.
 */
export function u64ToBigInt(scval) {
  return BigInt(scval.u64().toString());
}

/**
 * Recursively convert an ScVal to a plain JS value, suitable for display.
 *
 * Handles: string, symbol, u32, u64, i128, bool, address, vec, map, void.
 */
export function scValToNative(val) {
  try {
    const type = val.switch().name;

    switch (type) {
      case "scvString":
        return val.str().toString();
      case "scvSymbol":
        return val.sym().toString();
      case "scvBool":
        return val.b();
      case "scvU32":
        return val.u32();
      case "scvU64":
        return BigInt(val.u64().toString());
      case "scvI128": {
        const hi = BigInt(val.i128().hi().toString());
        const lo = BigInt(val.i128().lo().toString());
        return (hi << 64n) | lo;
      }
      case "scvAddress":
        return val.address().accountId()?.ed25519()
          ? new Address(val).toString()
          : val.address().toString();
      case "scvVec": {
        const vec = val.vec();
        return vec ? vec.map(scValToNative) : [];
      }
      case "scvMap": {
        const map = val.map();
        if (!map) return {};
        const obj = {};
        for (const entry of map) {
          const key = scValToNative(entry.key());
          obj[String(key)] = scValToNative(entry.val());
        }
        return obj;
      }
      case "scvVoid":
        return null;
      default:
        return `<${type}>`;
    }
  } catch {
    return "<unreadable>";
  }
}

/**
 * Format a raw on-chain amount (stroops / base units) as a human-readable
 * token amount with 7 decimal places (Stellar standard).
 *
 * @param {bigint} raw  – Amount in base units (stroops)
 * @param {number} [decimals=7]
 * @returns {string}  e.g. "100.0000000"
 */
export function formatAmount(raw, decimals = 7) {
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  return `${whole}.${frac.toString().padStart(decimals, "0")}`;
}
