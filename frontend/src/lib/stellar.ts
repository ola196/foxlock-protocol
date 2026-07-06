/**
 * Stellar / Soroban RPC helpers.
 *
 * Provides typed wrappers for invoking the deployed escrow and reputation
 * contracts. All contract calls go through the Soroban RPC — no Horizon
 * needed for contract invocations.
 */

import {
  SorobanRpc,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Contract,
  nativeToScVal,
  Address,
  xdr,
} from "@stellar/stellar-sdk";

const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? "https://soroban-testnet.stellar.org";

const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ??
  Networks.TESTNET;

export const ESCROW_CONTRACT_ID =
  process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID ?? "";

export const REPUTATION_CONTRACT_ID =
  process.env.NEXT_PUBLIC_REPUTATION_CONTRACT_ID ?? "";

export const server = new SorobanRpc.Server(RPC_URL, { allowHttp: false });

/**
 * Build a Soroban contract invocation transaction, simulate it,
 * and return the prepared XDR ready for signing.
 */
export async function buildContractCall(
  caller: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[]
): Promise<string> {
  const account = await server.getAccount(caller);
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  // Simulate to get the correct resource footprint + fee estimate
  const simResult = await server.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  // Assemble the final transaction with simulation results
  const prepared = SorobanRpc.assembleTransaction(tx, simResult).build();
  return prepared.toXDR();
}

/**
 * Submit a signed XDR transaction and wait for confirmation.
 */
export async function submitTransaction(
  signedXdr: string
): Promise<SorobanRpc.Api.GetSuccessfulTransactionResponse> {
  const txResult = await server.sendTransaction(
    TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE)
  );

  if (txResult.status === "ERROR") {
    throw new Error(`Transaction failed: ${txResult.errorResult}`);
  }

  // Poll for confirmation
  let getResult = await server.getTransaction(txResult.hash);
  let attempts = 0;

  while (
    getResult.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND &&
    attempts < 20
  ) {
    await new Promise((r) => setTimeout(r, 1500));
    getResult = await server.getTransaction(txResult.hash);
    attempts++;
  }

  if (getResult.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Transaction did not succeed: ${getResult.status}`);
  }

  return getResult as SorobanRpc.Api.GetSuccessfulTransactionResponse;
}

/**
 * Read-only contract query (no signing required).
 */
export async function queryContract<T>(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  parser: (val: xdr.ScVal) => T
): Promise<T> {
  // Use a dummy account for simulation-only calls
  const SIMULATION_SOURCE = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

  const account = await server.getAccount(SIMULATION_SOURCE).catch(() => {
    throw new Error("Cannot reach Stellar RPC — check your connection.");
  });

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
    throw new Error(`Query simulation failed: ${simResult.error}`);
  }

  const returnVal = (simResult as SorobanRpc.Api.SimulateTransactionSuccessResponse)
    .result?.retval;

  if (!returnVal) {
    throw new Error("No return value from contract query");
  }

  return parser(returnVal);
}

// ── ScVal helpers ─────────────────────────────────────────────────────────────

export const toAddress = (addr: string) =>
  new Address(addr).toScVal();

export const toU64 = (n: bigint | number) =>
  xdr.ScVal.scvU64(xdr.Uint64.fromString(n.toString()));

export const toU32 = (n: number) =>
  xdr.ScVal.scvU32(n);

export const toI128 = (n: bigint) =>
  nativeToScVal(n, { type: "i128" });

export const toString = (s: string) =>
  xdr.ScVal.scvString(s);
