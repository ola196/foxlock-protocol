"use client";

/**
 * Create Escrow page.
 *
 * Lets a client define an escrow agreement with milestones,
 * signs and submits the transaction via their Stellar wallet.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { useWalletStore } from "@/store/walletStore";
import {
  buildContractCall,
  submitTransaction,
  ESCROW_CONTRACT_ID,
  toAddress,
  toU32,
  toString,
} from "@/lib/stellar";
import { signTransaction } from "@/lib/wallet";
import { xdr, nativeToScVal } from "@stellar/stellar-sdk";
import clsx from "clsx";

interface MilestoneInput {
  title: string;
  amount: string;
}

export default function CreateEscrowPage() {
  const router = useRouter();
  const { address, connect } = useWalletStore();

  const [contributor, setContributor] = useState("");
  const [arbitrator, setArbitrator] = useState("");
  const [token, setToken] = useState("");
  const [deadlineLedgers, setDeadlineLedgers] = useState("17280"); // ~1 day
  const [description, setDescription] = useState("");
  const [milestones, setMilestones] = useState<MilestoneInput[]>([
    { title: "", amount: "" },
    { title: "", amount: "" },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addMilestone = () => {
    if (milestones.length < 20) {
      setMilestones([...milestones, { title: "", amount: "" }]);
    }
  };

  const removeMilestone = (index: number) => {
    if (milestones.length > 1) {
      setMilestones(milestones.filter((_, i) => i !== index));
    }
  };

  const totalAmount = milestones.reduce(
    (sum, m) => sum + (parseFloat(m.amount) || 0),
    0
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address) {
      await connect();
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Build milestones as ScVal Vec
      const milestonesScVal = xdr.ScVal.scvVec(
        milestones.map((m) =>
          xdr.ScVal.scvMap([
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol("title"),
              val: toString(m.title),
            }),
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol("amount"),
              val: nativeToScVal(BigInt(Math.round(parseFloat(m.amount) * 1e7)), {
                type: "i128",
              }),
            }),
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol("status"),
              val: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Pending")]),
            }),
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol("proof_url"),
              val: toString(""),
            }),
          ])
        )
      );

      // Get current ledger sequence to compute absolute deadline
      const { SorobanRpc } = await import("@stellar/stellar-sdk");
      const { server } = await import("@/lib/stellar");
      const ledgerResponse = await server.getLatestLedger();
      const deadlineAbsolute =
        ledgerResponse.sequence + parseInt(deadlineLedgers, 10);

      const xdrStr = await buildContractCall(
        address,
        ESCROW_CONTRACT_ID,
        "create_escrow",
        [
          toAddress(address),       // client
          toAddress(contributor),   // contributor
          toAddress(arbitrator),    // arbitrator
          toAddress(token),         // token contract
          milestonesScVal,          // milestones
          toU32(deadlineAbsolute),  // deadline_ledger
          toString(description),    // description
        ]
      );

      const signedXdr = await signTransaction(xdrStr, { address });
      const result = await submitTransaction(signedXdr);

      // Parse the returned escrow ID from the result
      const escrowId = result.returnValue?.value()?.toString() ?? "1";
      router.push(`/escrow/${escrowId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transaction failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Create Escrow</h1>
        <p className="text-gray-400 mt-2">
          Lock funds into a trustless agreement with milestone-based release.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        {/* Participants */}
        <fieldset className="card space-y-4">
          <legend className="text-sm font-semibold text-gray-300 mb-4">
            Participants
          </legend>

          <div>
            <label
              htmlFor="contributor"
              className="block text-sm text-gray-400 mb-1"
            >
              Contributor address
            </label>
            <input
              id="contributor"
              type="text"
              value={contributor}
              onChange={(e) => setContributor(e.target.value)}
              placeholder="G..."
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-blue-500"
              aria-describedby="contributor-hint"
            />
            <p id="contributor-hint" className="text-xs text-gray-500 mt-1">
              The Stellar address of the person doing the work.
            </p>
          </div>

          <div>
            <label
              htmlFor="arbitrator"
              className="block text-sm text-gray-400 mb-1"
            >
              Arbitrator address
            </label>
            <input
              id="arbitrator"
              type="text"
              value={arbitrator}
              onChange={(e) => setArbitrator(e.target.value)}
              placeholder="G..."
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-blue-500"
            />
          </div>
        </fieldset>

        {/* Token & Deadline */}
        <fieldset className="card space-y-4">
          <legend className="text-sm font-semibold text-gray-300 mb-4">
            Payment Settings
          </legend>

          <div>
            <label
              htmlFor="token"
              className="block text-sm text-gray-400 mb-1"
            >
              Token contract ID (SEP-0041)
            </label>
            <input
              id="token"
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="C... (e.g. USDC on testnet)"
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label
              htmlFor="deadline"
              className="block text-sm text-gray-400 mb-1"
            >
              Deadline (ledgers from now)
            </label>
            <input
              id="deadline"
              type="number"
              value={deadlineLedgers}
              onChange={(e) => setDeadlineLedgers(e.target.value)}
              min="100"
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500"
              aria-describedby="deadline-hint"
            />
            <p id="deadline-hint" className="text-xs text-gray-500 mt-1">
              17,280 ledgers ≈ 1 day. After this, contributor can claim without
              approval.
            </p>
          </div>
        </fieldset>

        {/* Description */}
        <div className="card">
          <label
            htmlFor="description"
            className="block text-sm text-gray-400 mb-2"
          >
            Description
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Describe this escrow agreement..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 resize-none"
          />
        </div>

        {/* Milestones */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-300">
              Milestones ({milestones.length}/20)
            </h2>
            <span className="text-sm text-gray-400">
              Total:{" "}
              <span className="text-white font-mono">
                {totalAmount.toFixed(2)} tokens
              </span>
            </span>
          </div>

          {milestones.map((m, i) => (
            <div key={i} className="flex gap-3 items-start">
              <div className="flex-1 space-y-2">
                <input
                  type="text"
                  value={m.title}
                  onChange={(e) => {
                    const updated = [...milestones];
                    updated[i] = { ...m, title: e.target.value };
                    setMilestones(updated);
                  }}
                  placeholder={`Milestone ${i + 1} title`}
                  required
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                  aria-label={`Milestone ${i + 1} title`}
                />
                <input
                  type="number"
                  value={m.amount}
                  onChange={(e) => {
                    const updated = [...milestones];
                    updated[i] = { ...m, amount: e.target.value };
                    setMilestones(updated);
                  }}
                  placeholder="Amount"
                  min="0.0000001"
                  step="any"
                  required
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                  aria-label={`Milestone ${i + 1} amount`}
                />
              </div>
              <button
                type="button"
                onClick={() => removeMilestone(i)}
                disabled={milestones.length === 1}
                className="mt-2 p-2 text-gray-600 hover:text-red-400 disabled:opacity-30 transition-colors"
                aria-label={`Remove milestone ${i + 1}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={addMilestone}
            disabled={milestones.length >= 20}
            className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 disabled:opacity-40 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add milestone
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="p-4 bg-red-950 border border-red-800 rounded-lg text-red-300 text-sm"
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className={clsx(
            "w-full py-3 rounded-lg font-medium text-white transition-colors flex items-center justify-center gap-2",
            isSubmitting
              ? "bg-gray-700 cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-500"
          )}
          aria-busy={isSubmitting}
        >
          {isSubmitting && (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          )}
          {!address
            ? "Connect Wallet to Continue"
            : isSubmitting
            ? "Creating Escrow…"
            : "Create Escrow"}
        </button>
      </form>
    </div>
  );
}
