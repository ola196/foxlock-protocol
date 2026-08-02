import {
  SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  Contract,
  Keypair,
  nativeToScVal,
  Address,
  xdr,
  Networks,
} from "@stellar/stellar-sdk";
import { RPC_URL, NETWORK_PASSPHRASE } from "./config.js";

export const server = new SorobanRpc.Server(RPC_URL, { allowHttp: false });

/**
 * Build, simulate, sign, and submit a contract call in one step.
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
    throw new Error(`Transaction error: ${JSON.stringify(sendResult.errorResult)}`);
  }

  // Poll for confirmation
  let result = await server.getTransaction(sendResult.hash);
  let attempts = 0;
  while (result.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND && attempts < 20) {
    await new Promise((r) => setTimeout(r, 1500));
    result = await server.getTransaction(sendResult.hash);
    attempts++;
  }

  if (result.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Transaction failed: ${result.status}`);
  }

  return { txHash: sendResult.hash, result };
}

/**
 * Read-only contract query (no signing).
 */
export async function queryContract(contractId, method, args) {
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

// ── ScVal helpers ─────────────────────────────────────────────────────────────
export const toAddress = (addr) => new Address(addr).toScVal();
export const toU64 = (n) => nativeToScVal(BigInt(n), { type: "u64" });
export const toU32 = (n) => xdr.ScVal.scvU32(n);
export const toI128 = (n) => nativeToScVal(BigInt(n), { type: "i128" });
export const toString = (s) => xdr.ScVal.scvString(s);
