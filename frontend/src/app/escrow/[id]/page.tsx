"use client";

/**
 * Escrow detail page — /escrow/[id]
 *
 * Displays the full EscrowRecord and renders context-aware action buttons
 * based on the connected wallet's role (client, contributor, arbitrator).
 *
 * Supported on-chain actions:
 *   Contributor: submit_milestone, claim_after_deadline
 *   Client:      approve_milestone, reject_milestone, raise_dispute, cancel_escrow
 *   Arbitrator:  resolve_dispute (when status is Disputed)
 *   Either:      raise_dispute
 *
 * Closes #31
 */

import React, { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  Gavel,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Shield,
  Send,
  Ban,
  Timer,
} from "lucide-react";
import clsx from "clsx";
import { xdr } from "@stellar/stellar-sdk";
import {
  queryContract,
  buildContractCall,
  submitTransaction,
  ESCROW_CONTRACT_ID,
  toAddress,
  toU64,
  toU32,
  toString,
  toI128,
} from "@/lib/stellar";
import { signTransaction } from "@/lib/wallet";
import { useWalletStore } from "@/store/walletStore";

// ─── Types ────────────────────────────────────────────────────────────────────

type EscrowStatus = "Active" | "Completed" | "Disputed" | "Cancelled";
type MilestoneStatus = "Pending" | "Submitted" | "Approved" | "Rejected";

interface Milestone {
  title: string;
  amount: string; // raw i128 as string
  status: MilestoneStatus;
  proofUrl: string;
}

interface EscrowRecord {
  id: number;
  client: string;
  contributor: string;
  arbitrator: string;
  token: string;
  totalAmount: string;
  releasedAmount: string;
  milestones: Milestone[];
  deadlineLedger: number;
  status: EscrowStatus;
  description: string;
}

// ─── ScVal parsing ────────────────────────────────────────────────────────────

function readStr(v: xdr.ScVal): string {
  try {
    if (v.switch().name === "scvString") return v.str().toString();
    if (v.switch().name === "scvSymbol") return v.sym().toString();
  } catch { /* ignore */ }
  return "";
}

function readAddress(v: xdr.ScVal): string {
  try {
    if (v.switch().name === "scvAddress") {
      const addr = v.address();
      if (addr.switch().name === "scAddressTypeAccount") {
        return addr.accountId().publicKey().toString();
      }
      // Contract address
      return addr.contractId().toString("hex");
    }
  } catch { /* ignore */ }
  return "";
}

function readI128(v: xdr.ScVal): string {
  try {
    if (v.switch().name === "scvI128") {
      const hi = BigInt(v.i128().hi().toString());
      const lo = BigInt(v.i128().lo().toString());
      return ((hi << 64n) | lo).toString();
    }
  } catch { /* ignore */ }
  return "0";
}

function readU32(v: xdr.ScVal): number {
  try {
    if (v.switch().name === "scvU32") return v.u32();
  } catch { /* ignore */ }
  return 0;
}

function readStatus<T extends string>(v: xdr.ScVal): T {
  try {
    if (v.switch().name === "scvVec") {
      const vec = v.vec();
      if (vec && vec.length > 0) return vec[0].sym().toString() as T;
    }
  } catch { /* ignore */ }
  return "Active" as T;
}

function parseMilestone(v: xdr.ScVal): Milestone {
  const map = v.map();
  const d: Record<string, xdr.ScVal> = {};
  if (map) {
    for (const e of map) {
      const k =
        e.key().switch().name === "scvSymbol"
          ? e.key().sym().toString()
          : e.key().str().toString();
      d[k] = e.val();
    }
  }
  return {
    title:    readStr(d["title"]),
    amount:   readI128(d["amount"]),
    status:   readStatus<MilestoneStatus>(d["status"]),
    proofUrl: readStr(d["proof_url"]),
  };
}

function parseEscrowRecord(val: xdr.ScVal, id: number): EscrowRecord {
  const map = val.map();
  if (!map) throw new Error("Expected ScVal map for EscrowRecord");
  const d: Record<string, xdr.ScVal> = {};
  for (const e of map) {
    const k =
      e.key().switch().name === "scvSymbol"
        ? e.key().sym().toString()
        : e.key().str().toString();
    d[k] = e.val();
  }

  const milestones: Milestone[] = [];
  try {
    const vec = d["milestones"]?.vec();
    if (vec) {
      for (const m of vec) milestones.push(parseMilestone(m as xdr.ScVal));
    }
  } catch { /* ignore */ }

  return {
    id,
    client:          readAddress(d["client"]),
    contributor:     readAddress(d["contributor"]),
    arbitrator:      readAddress(d["arbitrator"]),
    token:           readAddress(d["token"]),
    totalAmount:     readI128(d["total_amount"]),
    releasedAmount:  readI128(d["released_amount"]),
    milestones,
    deadlineLedger:  readU32(d["deadline_ledger"]),
    status:          readStatus<EscrowStatus>(d["status"]),
    description:     readStr(d["description"]),
  };
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function formatAmount(raw: string): string {
  try {
    const n = BigInt(raw);
    if (n === 0n) return "0";
    const whole = n / BigInt(1e7);
    const frac  = n % BigInt(1e7);
    if (frac === 0n) return whole.toLocaleString();
    return `${whole.toLocaleString()}.${frac.toString().padStart(7, "0").replace(/0+$/, "")}`;
  } catch { return raw; }
}

function shortAddr(addr: string): string {
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// ─── Style maps ───────────────────────────────────────────────────────────────

const ESCROW_STATUS_STYLES: Record<EscrowStatus, string> = {
  Active:    "text-blue-300 bg-blue-900/30 border-blue-700",
  Completed: "text-green-300 bg-green-900/30 border-green-700",
  Disputed:  "text-red-300 bg-red-900/30 border-red-700",
  Cancelled: "text-gray-400 bg-gray-800 border-gray-700",
};

const MILESTONE_STATUS_STYLES: Record<MilestoneStatus, string> = {
  Pending:   "text-gray-400 bg-gray-800 border-gray-700",
  Submitted: "text-yellow-300 bg-yellow-900/30 border-yellow-700",
  Approved:  "text-green-300 bg-green-900/30 border-green-700",
  Rejected:  "text-red-300 bg-red-900/30 border-red-700",
};

const MILESTONE_STATUS_ICON: Record<MilestoneStatus, React.JSX.Element> = {
  Pending:   <Clock className="w-3.5 h-3.5" aria-hidden="true" />,
  Submitted: <Send className="w-3.5 h-3.5" aria-hidden="true" />,
  Approved:  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />,
  Rejected:  <XCircle className="w-3.5 h-3.5" aria-hidden="true" />,
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function EscrowDetailPage() {
  const params    = useParams<{ id: string }>();
  const escrowId  = parseInt(params.id, 10);

  const { address, connect } = useWalletStore();

  const [escrow, setEscrow]           = useState<EscrowRecord | null>(null);
  const [isLoading, setIsLoading]     = useState(true);
  const [fetchError, setFetchError]   = useState<string | null>(null);
  const [txError, setTxError]         = useState<string | null>(null);
  const [txPending, setTxPending]     = useState<string | null>(null); // action key
  const [txSuccess, setTxSuccess]     = useState<string | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  // Modal state for actions that need extra input
  const [proofUrl, setProofUrl]               = useState("");
  const [proofTarget, setProofTarget]         = useState<number | null>(null);
  const [disputeClientAmt, setDisputeClientAmt]       = useState("");
  const [disputeContribAmt, setDisputeContribAmt]     = useState("");
  const [showDisputeResolve, setShowDisputeResolve]   = useState(false);

  // ── Fetch escrow ───────────────────────────────────────────────────────────
  const loadEscrow = useCallback(async () => {
    if (isNaN(escrowId) || escrowId < 1) {
      setFetchError("Invalid escrow ID.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setFetchError(null);
    try {
      const record = await queryContract<EscrowRecord>(
        ESCROW_CONTRACT_ID,
        "get_escrow",
        [toU64(escrowId)],
        (val) => parseEscrowRecord(val, escrowId)
      );
      setEscrow(record);
    } catch (err) {
      setFetchError(
        err instanceof Error && err.message.includes("NotFound")
          ? `Escrow #${escrowId} does not exist.`
          : err instanceof Error
          ? err.message
          : "Failed to load escrow"
      );
    } finally {
      setIsLoading(false);
    }
  }, [escrowId]);

  useEffect(() => { loadEscrow(); }, [loadEscrow]);

  // ── Derived role ───────────────────────────────────────────────────────────
  const isClient      = !!address && escrow?.client      === address;
  const isContributor = !!address && escrow?.contributor === address;
  const isArbitrator  = !!address && escrow?.arbitrator  === address;

  // ── Generic contract call helper ──────────────────────────────────────────
  async function callContract(
    actionKey: string,
    method: string,
    args: xdr.ScVal[]
  ) {
    if (!address) { await connect(); return; }
    setTxPending(actionKey);
    setTxError(null);
    setTxSuccess(null);
    try {
      const xdrStr    = await buildContractCall(address, ESCROW_CONTRACT_ID, method, args);
      const signedXdr = await signTransaction(xdrStr, { address });
      await submitTransaction(signedXdr);
      setTxSuccess(actionKey);
      await loadEscrow(); // refresh
    } catch (err) {
      setTxError(err instanceof Error ? err.message : "Transaction failed");
    } finally {
      setTxPending(null);
    }
  }

  // ── Action handlers ────────────────────────────────────────────────────────

  const handleSubmitMilestone = async (milestoneIndex: number) => {
    if (!proofUrl.trim()) return;
    await callContract(
      `submit-${milestoneIndex}`,
      "submit_milestone",
      [toAddress(address!), toU64(escrowId), toU32(milestoneIndex), toString(proofUrl.trim())]
    );
    setProofUrl("");
    setProofTarget(null);
  };

  const handleApproveMilestone = (milestoneIndex: number) =>
    callContract(
      `approve-${milestoneIndex}`,
      "approve_milestone",
      [toAddress(address!), toU64(escrowId), toU32(milestoneIndex)]
    );

  const handleRejectMilestone = (milestoneIndex: number) =>
    callContract(
      `reject-${milestoneIndex}`,
      "reject_milestone",
      [toAddress(address!), toU64(escrowId), toU32(milestoneIndex)]
    );

  const handleRaiseDispute = () =>
    callContract(
      "raise-dispute",
      "raise_dispute",
      [toAddress(address!), toU64(escrowId)]
    );

  const handleCancelEscrow = () =>
    callContract(
      "cancel",
      "cancel_escrow",
      [toAddress(address!), toU64(escrowId)]
    );

  const handleClaimAfterDeadline = () =>
    callContract(
      "claim-deadline",
      "claim_after_deadline",
      [toAddress(address!), toU64(escrowId)]
    );

  const handleResolveDispute = async () => {
    const clientAmt = BigInt(Math.round(parseFloat(disputeClientAmt || "0") * 1e7));
    const contribAmt = BigInt(Math.round(parseFloat(disputeContribAmt || "0") * 1e7));
    await callContract(
      "resolve-dispute",
      "resolve_dispute",
      [
        toAddress(address!),
        toU64(escrowId),
        toI128(clientAmt),
        toI128(contribAmt),
      ]
    );
    setShowDisputeResolve(false);
    setDisputeClientAmt("");
    setDisputeContribAmt("");
  };

  // ── Progress calculation ───────────────────────────────────────────────────
  const progressPct = escrow
    ? escrow.totalAmount !== "0"
      ? Number((BigInt(escrow.releasedAmount) * 100n) / BigInt(escrow.totalAmount))
      : 0
    : 0;

  const approvedCount = escrow?.milestones.filter((m) => m.status === "Approved").length ?? 0;

  // ── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" aria-hidden="true" />
        <span>Loading escrow…</span>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <Link
          href="/escrow"
          className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Back to Escrows
        </Link>
        <div
          role="alert"
          className="flex items-start gap-3 p-6 bg-gray-900 border border-gray-700 rounded-xl text-gray-400"
        >
          <AlertCircle className="w-5 h-5 mt-0.5 shrink-0 text-red-400" aria-hidden="true" />
          <div>
            <p className="font-medium text-white mb-1">Escrow not found</p>
            <p className="text-sm">{fetchError}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!escrow) return null;

  const isActive    = escrow.status === "Active";
  const isDisputed  = escrow.status === "Disputed";

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Back nav */}
      <Link
        href="/escrow"
        className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        Back to Escrows
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">
            Escrow <span className="text-gray-500">#{escrow.id}</span>
          </h1>
          {escrow.description && (
            <p className="text-gray-400 mt-1">{escrow.description}</p>
          )}
        </div>
        <span
          className={clsx(
            "inline-block px-3 py-1 rounded-full border text-sm font-semibold self-start",
            ESCROW_STATUS_STYLES[escrow.status]
          )}
        >
          {escrow.status}
        </span>
      </div>

      {/* Transaction feedback */}
      {txError && (
        <div
          role="alert"
          className="flex items-start gap-3 p-4 bg-red-950 border border-red-800 rounded-lg text-red-300 text-sm"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{txError}</span>
        </div>
      )}
      {txSuccess && (
        <div
          role="status"
          className="flex items-center gap-3 p-4 bg-green-950 border border-green-800 rounded-lg text-green-300 text-sm"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          Transaction confirmed.
        </div>
      )}

      {/* Wallet prompt */}
      {!address && (
        <div className="card flex items-center justify-between gap-4 py-3">
          <p className="text-sm text-gray-400">Connect your wallet to interact with this escrow.</p>
          <button
            onClick={connect}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors shrink-0"
          >
            Connect Wallet
          </button>
        </div>
      )}

      {/* Summary card */}
      <div className="card space-y-6">
        {/* Amount overview */}
        <div>
          <div className="flex items-end justify-between mb-2">
            <span className="text-sm text-gray-400">Released</span>
            <span className="text-sm font-mono text-gray-400">
              {formatAmount(escrow.releasedAmount)} / {formatAmount(escrow.totalAmount)} tokens
            </span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-2">
            <div
              className={clsx(
                "h-2 rounded-full transition-all",
                escrow.status === "Completed" ? "bg-green-500" :
                escrow.status === "Disputed"  ? "bg-red-500"   : "bg-blue-500"
              )}
              style={{ width: `${progressPct}%` }}
              role="progressbar"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${progressPct}% of funds released`}
            />
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-xs text-gray-600">{progressPct}% released</span>
            <span className="text-xs text-gray-600">
              {approvedCount}/{escrow.milestones.length} milestones done
            </span>
          </div>
        </div>

        {/* Participants */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          {[
            { label: "Client",      value: escrow.client,      highlight: isClient },
            { label: "Contributor", value: escrow.contributor, highlight: isContributor },
            { label: "Arbitrator",  value: escrow.arbitrator,  highlight: isArbitrator },
          ].map(({ label, value, highlight }) => (
            <div key={label} className="bg-gray-800/50 rounded-lg p-3 space-y-1">
              <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
              <p
                className={clsx("font-mono text-xs break-all", highlight ? "text-blue-300" : "text-gray-300")}
                title={value}
              >
                {shortAddr(value) || <span className="italic text-gray-600">—</span>}
                {highlight && (
                  <span className="ml-1 text-blue-400 text-xs">(you)</span>
                )}
              </p>
            </div>
          ))}
        </div>

        {/* Meta: deadline & token */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="bg-gray-800/50 rounded-lg p-3 space-y-1">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Deadline Ledger</p>
            <p className="font-mono text-gray-300">{escrow.deadlineLedger.toLocaleString()}</p>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3 space-y-1">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Token</p>
            <p className="font-mono text-xs text-gray-300 break-all" title={escrow.token}>
              {shortAddr(escrow.token)}
            </p>
          </div>
        </div>
      </div>

      {/* ── Top-level actions ──────────────────────────────────────────── */}
      {(isActive || isDisputed) && address && (
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-gray-300">Actions</h2>
          <div className="flex flex-wrap gap-3">

            {/* Raise dispute — client or contributor, active only */}
            {isActive && (isClient || isContributor) && (
              <button
                onClick={handleRaiseDispute}
                disabled={txPending !== null}
                className="flex items-center gap-2 px-4 py-2 bg-red-900/40 border border-red-700 hover:bg-red-900/70 disabled:opacity-50 text-red-300 rounded-lg text-sm font-medium transition-colors"
                aria-label="Raise a dispute"
              >
                {txPending === "raise-dispute" ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Gavel className="w-4 h-4" aria-hidden="true" />
                )}
                Raise Dispute
              </button>
            )}

            {/* Cancel escrow — client only, active only */}
            {isActive && isClient && (
              <button
                onClick={handleCancelEscrow}
                disabled={txPending !== null}
                className="flex items-center gap-2 px-4 py-2 bg-gray-800 border border-gray-700 hover:bg-gray-700 disabled:opacity-50 text-gray-300 rounded-lg text-sm font-medium transition-colors"
                aria-label="Cancel escrow and refund"
              >
                {txPending === "cancel" ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Ban className="w-4 h-4" aria-hidden="true" />
                )}
                Cancel Escrow
              </button>
            )}

            {/* Claim after deadline — contributor only */}
            {isActive && isContributor && (
              <button
                onClick={handleClaimAfterDeadline}
                disabled={txPending !== null}
                className="flex items-center gap-2 px-4 py-2 bg-orange-900/40 border border-orange-700 hover:bg-orange-900/70 disabled:opacity-50 text-orange-300 rounded-lg text-sm font-medium transition-colors"
                aria-label="Claim funds after deadline"
              >
                {txPending === "claim-deadline" ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Timer className="w-4 h-4" aria-hidden="true" />
                )}
                Claim After Deadline
              </button>
            )}

            {/* Resolve dispute — arbitrator only */}
            {isDisputed && isArbitrator && (
              <button
                onClick={() => setShowDisputeResolve((s) => !s)}
                disabled={txPending !== null}
                className="flex items-center gap-2 px-4 py-2 bg-purple-900/40 border border-purple-700 hover:bg-purple-900/70 disabled:opacity-50 text-purple-300 rounded-lg text-sm font-medium transition-colors"
                aria-label="Resolve dispute"
                aria-expanded={showDisputeResolve}
              >
                <Shield className="w-4 h-4" aria-hidden="true" />
                Resolve Dispute
              </button>
            )}
          </div>

          {/* Resolve dispute form */}
          {showDisputeResolve && isDisputed && isArbitrator && (
            <div className="border border-purple-800 bg-purple-950/20 rounded-lg p-4 space-y-4 mt-2">
              <p className="text-sm text-purple-200">
                Split the remaining{" "}
                <span className="font-mono font-bold">
                  {formatAmount(
                    (BigInt(escrow.totalAmount) - BigInt(escrow.releasedAmount)).toString()
                  )}
                </span>{" "}
                tokens between client and contributor.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="client-amount"
                    className="block text-xs text-gray-400 mb-1"
                  >
                    Client amount
                  </label>
                  <input
                    id="client-amount"
                    type="number"
                    value={disputeClientAmt}
                    onChange={(e) => setDisputeClientAmt(e.target.value)}
                    min="0"
                    step="any"
                    placeholder="0"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                    aria-label="Amount to return to client"
                  />
                </div>
                <div>
                  <label
                    htmlFor="contrib-amount"
                    className="block text-xs text-gray-400 mb-1"
                  >
                    Contributor amount
                  </label>
                  <input
                    id="contrib-amount"
                    type="number"
                    value={disputeContribAmt}
                    onChange={(e) => setDisputeContribAmt(e.target.value)}
                    min="0"
                    step="any"
                    placeholder="0"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                    aria-label="Amount to release to contributor"
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleResolveDispute}
                  disabled={!disputeClientAmt || !disputeContribAmt || txPending !== null}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {txPending === "resolve-dispute" && (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  )}
                  Confirm Resolution
                </button>
                <button
                  onClick={() => setShowDisputeResolve(false)}
                  className="px-4 py-2 bg-gray-800 border border-gray-700 hover:bg-gray-700 text-gray-400 rounded-lg text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Milestones ───────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">
          Milestones
          <span className="ml-2 text-sm font-normal text-gray-500">
            ({escrow.milestones.length})
          </span>
        </h2>

        {escrow.milestones.map((m, idx) => {
          const isExpanded    = expandedIdx === idx;
          const canSubmit     = isContributor && isActive && (m.status === "Pending" || m.status === "Rejected");
          const canApprove    = isClient && isActive && m.status === "Submitted";
          const canReject     = isClient && isActive && m.status === "Submitted";
          const showingProof  = proofTarget === idx;

          return (
            <div
              key={idx}
              className={clsx(
                "card transition-colors",
                m.status === "Approved" ? "border-green-900/50" :
                m.status === "Submitted" ? "border-yellow-900/50" :
                m.status === "Rejected"  ? "border-red-900/50"   : ""
              )}
            >
              {/* Milestone header row */}
              <button
                onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                className="w-full flex items-center gap-4 text-left"
                aria-expanded={isExpanded}
                aria-controls={`milestone-${idx}-body`}
              >
                {/* Index indicator */}
                <span className="w-7 h-7 rounded-full bg-gray-800 flex items-center justify-center text-xs text-gray-400 shrink-0 font-mono">
                  {idx + 1}
                </span>

                {/* Title */}
                <span className="flex-1 font-medium text-sm truncate">{m.title || `Milestone ${idx + 1}`}</span>

                {/* Amount */}
                <span className="text-sm font-mono text-gray-400 shrink-0">
                  {formatAmount(m.amount)} tokens
                </span>

                {/* Status badge */}
                <span
                  className={clsx(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium shrink-0",
                    MILESTONE_STATUS_STYLES[m.status]
                  )}
                >
                  {MILESTONE_STATUS_ICON[m.status]}
                  {m.status}
                </span>

                {/* Expand chevron */}
                {isExpanded
                  ? <ChevronUp className="w-4 h-4 text-gray-500 shrink-0" aria-hidden="true" />
                  : <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" aria-hidden="true" />
                }
              </button>

              {/* Expanded body */}
              {isExpanded && (
                <div
                  id={`milestone-${idx}-body`}
                  className="mt-4 space-y-4 border-t border-gray-800 pt-4"
                >
                  {/* Proof URL */}
                  {m.proofUrl ? (
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Proof</p>
                      <a
                        href={m.proofUrl.startsWith("ipfs://")
                          ? `https://ipfs.io/ipfs/${m.proofUrl.slice(7)}`
                          : m.proofUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-400 hover:underline break-all"
                      >
                        {m.proofUrl}
                      </a>
                    </div>
                  ) : m.status !== "Pending" ? (
                    <p className="text-sm text-gray-600 italic">No proof URL provided.</p>
                  ) : null}

                  {/* Client actions */}
                  {(canApprove || canReject) && (
                    <div className="flex gap-3">
                      {canApprove && (
                        <button
                          onClick={() => handleApproveMilestone(idx)}
                          disabled={txPending !== null}
                          className="flex items-center gap-2 px-4 py-2 bg-green-900/40 border border-green-700 hover:bg-green-900/70 disabled:opacity-50 text-green-300 rounded-lg text-sm font-medium transition-colors"
                          aria-label={`Approve milestone ${idx + 1}`}
                        >
                          {txPending === `approve-${idx}` ? (
                            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                          )}
                          Approve
                        </button>
                      )}
                      {canReject && (
                        <button
                          onClick={() => handleRejectMilestone(idx)}
                          disabled={txPending !== null}
                          className="flex items-center gap-2 px-4 py-2 bg-red-900/40 border border-red-700 hover:bg-red-900/70 disabled:opacity-50 text-red-300 rounded-lg text-sm font-medium transition-colors"
                          aria-label={`Reject milestone ${idx + 1}`}
                        >
                          {txPending === `reject-${idx}` ? (
                            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <XCircle className="w-4 h-4" aria-hidden="true" />
                          )}
                          Reject
                        </button>
                      )}
                    </div>
                  )}

                  {/* Contributor submit action */}
                  {canSubmit && (
                    <div className="space-y-3">
                      {!showingProof ? (
                        <button
                          onClick={() => { setProofTarget(idx); setProofUrl(""); }}
                          className="flex items-center gap-2 px-4 py-2 bg-blue-900/40 border border-blue-700 hover:bg-blue-900/70 text-blue-300 rounded-lg text-sm font-medium transition-colors"
                          aria-label={`Submit proof for milestone ${idx + 1}`}
                        >
                          <Send className="w-4 h-4" aria-hidden="true" />
                          {m.status === "Rejected" ? "Resubmit Proof" : "Submit Proof"}
                        </button>
                      ) : (
                        <div className="space-y-3">
                          <label
                            htmlFor={`proof-url-${idx}`}
                            className="block text-xs text-gray-400"
                          >
                            Proof URL (IPFS CID or HTTPS link)
                          </label>
                          <input
                            id={`proof-url-${idx}`}
                            type="text"
                            value={proofUrl}
                            onChange={(e) => setProofUrl(e.target.value)}
                            placeholder="ipfs://Qm… or https://…"
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                            aria-label="Proof URL"
                          />
                          <div className="flex gap-3">
                            <button
                              onClick={() => handleSubmitMilestone(idx)}
                              disabled={!proofUrl.trim() || txPending !== null}
                              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                            >
                              {txPending === `submit-${idx}` ? (
                                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                              ) : (
                                <Send className="w-4 h-4" aria-hidden="true" />
                              )}
                              Submit
                            </button>
                            <button
                              onClick={() => { setProofTarget(null); setProofUrl(""); }}
                              className="px-4 py-2 bg-gray-800 border border-gray-700 hover:bg-gray-700 text-gray-400 rounded-lg text-sm transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Stellar Explorer link */}
      <p className="text-center text-xs text-gray-600 pb-4">
        View contract on{" "}
        <a
          href={`https://stellar.expert/explorer/testnet/contract/${ESCROW_CONTRACT_ID}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:underline"
        >
          Stellar Expert
        </a>
      </p>
    </div>
  );
}
