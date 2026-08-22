/**
 * @foxlock/escrow-sdk — EscrowClient
 *
 * Typed client for all FoxLock escrow contract methods.
 *
 * ## Two-step transaction flow
 *
 * State-changing methods return a `PreparedTransaction` containing signed-ready
 * XDR. You sign it with your wallet (Freighter, Stellar Wallets Kit, etc.) and
 * call `client.submit(signedXdr)` to broadcast it.
 *
 * ```ts
 * const client = new EscrowClient({ contractId: "C...", rpcUrl: "..." });
 *
 * // 1. Build + simulate
 * const prepared = await client.createEscrow({ client: "G...", ... });
 *
 * // 2. Sign with wallet
 * const signed = await wallet.signTransaction(prepared.xdr);
 *
 * // 3. Submit + confirm
 * const result = await client.submit(signed);
 * console.log("Escrow ID:", result.returnValue);
 * ```
 *
 * Read-only queries resolve immediately without signing.
 */

import {
  rpc,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Contract,
  xdr,
} from "@stellar/stellar-sdk";

import type {
  AcceptDeadlineExtensionParams,
  ApproveMilestoneParams,
  CancelEscrowParams,
  ClaimAfterDeadlineParams,
  CreateEscrowParams,
  EscrowClientConfig,
  EscrowRecord,
  PreparedTransaction,
  ProposeDeadlineExtensionParams,
  RaiseDisputeParams,
  RejectMilestoneParams,
  ResolveDisputeParams,
  SubmitMilestoneParams,
  TransactionResult,
} from "./types.js";

import {
  decodeEscrowRecord,
  decodeI128,
  decodeU64,
  EscrowContractError,
  encodeAddress,
  encodeI128,
  encodeMilestones,
  encodeString,
  encodeU32,
  encodeU64,
} from "./codec.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";
const DEFAULT_NETWORK_PASSPHRASE = Networks.TESTNET;

/**
 * Well-funded Testnet account used as a fee-payer placeholder for
 * read-only simulations. Never signs anything — only provides an account
 * sequence number for the transaction builder.
 */
const SIMULATION_SOURCE =
  "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

// ── EscrowClient ──────────────────────────────────────────────────────────────

export class EscrowClient {
  private readonly server: rpc.Server;
  private readonly contract: Contract;
  private readonly networkPassphrase: string;

  constructor(config: EscrowClientConfig) {
    this.server = new rpc.Server(
      config.rpcUrl ?? DEFAULT_RPC_URL,
      { allowHttp: false }
    );
    this.contract = new Contract(config.contractId);
    this.networkPassphrase =
      config.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /**
   * Build a transaction from a caller address + method + args,
   * simulate it to get the resource footprint, and return the assembled XDR.
   */
  private async prepare(
    caller: string,
    method: string,
    args: xdr.ScVal[]
  ): Promise<PreparedTransaction> {
    const account = await this.server.getAccount(caller);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const simResult = await this.server.simulateTransaction(tx);

    if (rpc.Api.isSimulationError(simResult)) {
      throw new Error(`Simulation failed: ${simResult.error}`);
    }

    const prepared = rpc.assembleTransaction(tx, simResult).build();
    const fee = (simResult as rpc.Api.SimulateTransactionSuccessResponse)
      .minResourceFee ?? BASE_FEE;

    return { xdr: prepared.toXDR(), fee: fee.toString() };
  }

  /**
   * Simulate a read-only contract call and return the raw return ScVal.
   */
  private async query(
    method: string,
    args: xdr.ScVal[]
  ): Promise<xdr.ScVal> {
    const account = await this.server.getAccount(SIMULATION_SOURCE).catch(
      () => { throw new Error("Cannot reach Stellar RPC — check your connection."); }
    );

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const simResult = await this.server.simulateTransaction(tx);

    if (rpc.Api.isSimulationError(simResult)) {
      throw new Error(`Query failed: ${simResult.error}`);
    }

    const retval = (
      simResult as rpc.Api.SimulateTransactionSuccessResponse
    ).result?.retval;

    if (!retval) {
      throw new Error(`No return value from ${method}`);
    }

    return retval;
  }

  // ── Public: submit ─────────────────────────────────────────────────────────

  /**
   * Submit a signed transaction XDR and wait for on-ledger confirmation.
   *
   * @param signedXdr - Base64 XDR string produced by your wallet's signTransaction
   */
  async submit(signedXdr: string): Promise<TransactionResult> {
    const tx = TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase);
    const sendResult = await this.server.sendTransaction(tx);

    if (sendResult.status === "ERROR") {
      throw new Error(
        `Transaction submission failed: ${JSON.stringify(sendResult.errorResult)}`
      );
    }

    let getResult = await this.server.getTransaction(sendResult.hash);
    let attempts = 0;

    while (
      getResult.status === rpc.Api.GetTransactionStatus.NOT_FOUND &&
      attempts < 20
    ) {
      await new Promise<void>((r) => setTimeout(r, 1500));
      getResult = await this.server.getTransaction(sendResult.hash);
      attempts++;
    }

    if (getResult.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw new Error(`Transaction failed with status: ${getResult.status}`);
    }

    const success = getResult as rpc.Api.GetSuccessfulTransactionResponse;
    return {
      hash: sendResult.hash,
      ledger: success.ledger,
      returnValue: success.returnValue,
    };
  }

  // ── Public: state-changing methods ────────────────────────────────────────

  /**
   * Prepare a `create_escrow` transaction.
   *
   * The client address (`params.client`) must sign the returned XDR — the
   * contract calls `client.require_auth()` inside.
   *
   * Returns the new escrow ID (u64) in `TransactionResult.returnValue` after
   * submission.
   */
  async createEscrow(params: CreateEscrowParams): Promise<PreparedTransaction> {
    return this.prepare(params.client, "create_escrow", [
      encodeAddress(params.client),
      encodeAddress(params.contributor),
      encodeAddress(params.arbitrator),
      encodeAddress(params.token),
      encodeMilestones(params.milestones),
      encodeU32(params.deadlineLedger),
      encodeString(params.description ?? ""),
      encodeU32(params.cliffLedger ?? 0),
    ]);
  }

  /**
   * Prepare a `submit_milestone` transaction.
   * Must be signed by `params.contributor`.
   */
  async submitMilestone(
    params: SubmitMilestoneParams
  ): Promise<PreparedTransaction> {
    return this.prepare(params.contributor, "submit_milestone", [
      encodeAddress(params.contributor),
      encodeU64(params.escrowId),
      encodeU32(params.milestoneIndex),
      encodeString(params.proofUrl),
    ]);
  }

  /**
   * Prepare an `approve_milestone` transaction.
   * Must be signed by `params.client`. Releases the milestone funds.
   */
  async approveMilestone(
    params: ApproveMilestoneParams
  ): Promise<PreparedTransaction> {
    return this.prepare(params.client, "approve_milestone", [
      encodeAddress(params.client),
      encodeU64(params.escrowId),
      encodeU32(params.milestoneIndex),
    ]);
  }

  /**
   * Prepare a `reject_milestone` transaction.
   * Must be signed by `params.client`. Contributor may resubmit afterwards.
   */
  async rejectMilestone(
    params: RejectMilestoneParams
  ): Promise<PreparedTransaction> {
    return this.prepare(params.client, "reject_milestone", [
      encodeAddress(params.client),
      encodeU64(params.escrowId),
      encodeU32(params.milestoneIndex),
    ]);
  }

  /**
   * Prepare a `raise_dispute` transaction.
   * Must be signed by either the client or the contributor.
   */
  async raiseDispute(
    params: RaiseDisputeParams
  ): Promise<PreparedTransaction> {
    return this.prepare(params.caller, "raise_dispute", [
      encodeAddress(params.caller),
      encodeU64(params.escrowId),
    ]);
  }

  /**
   * Prepare a `resolve_dispute` transaction.
   * Must be signed by the arbitrator.
   * `clientAmount + contributorAmount` must equal the unreleased balance.
   */
  async resolveDispute(
    params: ResolveDisputeParams
  ): Promise<PreparedTransaction> {
    return this.prepare(params.arbitrator, "resolve_dispute", [
      encodeAddress(params.arbitrator),
      encodeU64(params.escrowId),
      encodeI128(params.clientAmount),
      encodeI128(params.contributorAmount),
    ]);
  }

  /**
   * Prepare a `cancel_escrow` transaction.
   * Must be signed by the client.
   * Blocked if any milestone has been submitted or approved.
   */
  async cancelEscrow(
    params: CancelEscrowParams
  ): Promise<PreparedTransaction> {
    return this.prepare(params.client, "cancel_escrow", [
      encodeAddress(params.client),
      encodeU64(params.escrowId),
    ]);
  }

  /**
   * Prepare a `claim_after_deadline` transaction.
   * Must be signed by the contributor.
   * Only succeeds after `deadlineLedger` has passed.
   */
  async claimAfterDeadline(
    params: ClaimAfterDeadlineParams
  ): Promise<PreparedTransaction> {
    return this.prepare(params.contributor, "claim_after_deadline", [
      encodeAddress(params.contributor),
      encodeU64(params.escrowId),
    ]);
  }

  /**
   * Prepare a `propose_deadline_extension` transaction.
   * Must be signed by the client or contributor.
   * The other party must then call `acceptDeadlineExtension`.
   */
  async proposeDeadlineExtension(
    params: ProposeDeadlineExtensionParams
  ): Promise<PreparedTransaction> {
    return this.prepare(params.caller, "propose_deadline_extension", [
      encodeAddress(params.caller),
      encodeU64(params.escrowId),
      encodeU32(params.newDeadline),
    ]);
  }

  /**
   * Prepare an `accept_deadline_extension` transaction.
   * Must be signed by the party who did NOT make the proposal.
   * `newDeadline` must match the pending proposal exactly.
   */
  async acceptDeadlineExtension(
    params: AcceptDeadlineExtensionParams
  ): Promise<PreparedTransaction> {
    return this.prepare(params.caller, "accept_deadline_extension", [
      encodeAddress(params.caller),
      encodeU64(params.escrowId),
      encodeU32(params.newDeadline),
    ]);
  }

  // ── Public: read-only queries ─────────────────────────────────────────────

  /**
   * Fetch the full escrow record for a given ID.
   * @throws {EscrowContractError} with code 2 (NotFound) if the escrow does not exist.
   */
  async getEscrow(escrowId: bigint): Promise<EscrowRecord> {
    const retval = await this.query("get_escrow", [encodeU64(escrowId)]);
    return decodeEscrowRecord(retval);
  }

  /**
   * Fetch the unreleased balance for a given escrow (in token base units).
   * @throws {EscrowContractError} with code 2 (NotFound) if the escrow does not exist.
   */
  async getBalance(escrowId: bigint): Promise<bigint> {
    const retval = await this.query("get_balance", [encodeU64(escrowId)]);
    return decodeI128(retval);
  }

  /**
   * Fetch the total number of escrows ever created on this contract.
   * Useful for building paginated escrow lists.
   */
  async getEscrowCount(): Promise<bigint> {
    const retval = await this.query("get_escrow_count", []);
    return decodeU64(retval);
  }
}
