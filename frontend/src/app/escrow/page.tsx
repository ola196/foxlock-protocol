"use client";

/**
 * Escrow browse page — /escrow
 *
 * Fetches the on-chain escrow count and lets users browse individual
 * escrows by ID. Each row links to the /escrow/[id] detail page.
 *
 * Because the Soroban contract stores each record by ID (1-indexed
 * counter), we query them in descending order so the most recent
 * escrows appear first. Users can also jump directly to an ID.
 *
 * Closes #31
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Loader2,
  Search,
  ChevronRight,
  AlertCircle,
  PlusCircle,
  Package,
} from "lucide-react";
import clsx from "clsx";
import {
  queryContract,
  ESCROW_CONTRACT_ID,
  toU64,
} from "@/lib/stellar";
import { xdr } from "@stellar/stellar-sdk";

// ─── Types ────────────────────────────────────────────────────────────────────

type EscrowStatus = "Active" | "Completed" | "Disputed" | "Cancelled";

interface EscrowSummary {
  id: number;
  status: EscrowStatus;
  description: string;
  totalAmount: string;
  releasedAmount: string;
  milestonesTotal: number;
  client: string;
  contributor: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<EscrowStatus, string> = {
  Active:    "text-blue-300 bg-blue-900/30 border-blue-700",
  Completed: "text-green-300 bg-green-900/30 border-green-700",
  Disputed:  "text-red-300 bg-red-900/30 border-red-700",
  Cancelled: "text-gray-400 bg-gray-800 border-gray-700",
};

/** Format a u64-as-string representing stroops into a readable decimal */
function formatAmount(raw: string): string {
  try {
    const n = BigInt(raw);
    const whole = n / BigInt(1e7);
    const frac = n % BigInt(1e7);
    if (frac === 0n) return whole.toString();
    return `${whole}.${frac.toString().padStart(7, "0").replace(/0+$/, "")}`;
  } catch {
    return raw;
  }
}

/** Shorten a Stellar address for display */
function shortAddr(addr: string): string {
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Parse a Soroban ScVal map representing an EscrowRecord */
function parseEscrowRecord(val: xdr.ScVal, id: number): EscrowSummary {
  const map = val.map();
  if (!map) throw new Error("Expected ScVal map");

  const data: Record<string, xdr.ScVal> = {};
  for (const entry of map) {
    const key =
      entry.key().switch().name === "scvSymbol"
        ? entry.key().sym().toString()
        : entry.key().str().toString();
    data[key] = entry.val();
  }

  const readStr = (v: xdr.ScVal): string => {
    try {
      if (v.switch().name === "scvString") return v.str().toString();
      if (v.switch().name === "scvSymbol") return v.sym().toString();
    } catch { /* ignore */ }
    return "";
  };

  const readAddress = (v: xdr.ScVal): string => {
    try {
      if (v.switch().name === "scvAddress") {
        return v.address().accountId().publicKey().toString();
      }
    } catch { /* ignore */ }
    return "";
  };

  const readI128 = (v: xdr.ScVal): string => {
    try {
      if (v.switch().name === "scvI128") {
        const hi = BigInt(v.i128().hi().toString());
        const lo = BigInt(v.i128().lo().toString());
        return ((hi << 64n) | lo).toString();
      }
    } catch { /* ignore */ }
    return "0";
  };

  const readStatus = (v: xdr.ScVal): EscrowStatus => {
    try {
      // Status is encoded as scvVec([scvSymbol("Active")]) or similar
      if (v.switch().name === "scvVec") {
        const vec = v.vec();
        if (vec && vec.length > 0) {
          return vec[0].sym().toString() as EscrowStatus;
        }
      }
    } catch { /* ignore */ }
    return "Active";
  };

  const readMilestoneCount = (v: xdr.ScVal): number => {
    try {
      if (v.switch().name === "scvVec") {
        return v.vec()?.length ?? 0;
      }
    } catch { /* ignore */ }
    return 0;
  };

  return {
    id,
    status:           readStatus(data["status"]),
    description:      readStr(data["description"]),
    totalAmount:      readI128(data["total_amount"]),
    releasedAmount:   readI128(data["released_amount"]),
    milestonesTotal:  readMilestoneCount(data["milestones"]),
    client:           readAddress(data["client"]),
    contributor:      readAddress(data["contributor"]),
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 10;

export default function EscrowListPage() {
  const [totalCount, setTotalCount]       = useState<number | null>(null);
  const [escrows, setEscrows]             = useState<EscrowSummary[]>([]);
  const [isLoadingCount, setLoadingCount] = useState(true);
  const [isLoadingRows, setLoadingRows]   = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const [page, setPage]                   = useState(0); // 0-indexed
  const [jumpId, setJumpId]               = useState("");

  // ── Fetch total escrow count ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoadingCount(true);
    setError(null);

    queryContract<number>(
      ESCROW_CONTRACT_ID,
      "get_escrow_count",
      [],
      (val) => {
        try {
          if (val.switch().name === "scvU64") {
            return parseInt(val.u64().toString(), 10);
          }
        } catch { /* ignore */ }
        return 0;
      }
    )
      .then((count) => {
        if (!cancelled) {
          setTotalCount(count);
          setLoadingCount(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to reach Stellar RPC"
          );
          setLoadingCount(false);
        }
      });

    return () => { cancelled = true; };
  }, []);

  // ── Fetch one page of escrows ─────────────────────────────────────────────
  const fetchPage = useCallback(async (pageIndex: number, count: number) => {
    if (count === 0) { setEscrows([]); return; }

    setLoadingRows(true);
    setError(null);

    // IDs are 1-based, newest = highest. Show newest first.
    const lastId  = count - pageIndex * PAGE_SIZE;
    const firstId = Math.max(1, lastId - PAGE_SIZE + 1);

    const ids = Array.from(
      { length: lastId - firstId + 1 },
      (_, i) => lastId - i   // descending
    );

    try {
      const results = await Promise.allSettled(
        ids.map((id) =>
          queryContract<EscrowSummary>(
            ESCROW_CONTRACT_ID,
            "get_escrow",
            [toU64(id)],
            (val) => parseEscrowRecord(val, id)
          )
        )
      );

      const loaded: EscrowSummary[] = results
        .filter((r): r is PromiseFulfilledResult<EscrowSummary> => r.status === "fulfilled")
        .map((r) => r.value);

      setEscrows(loaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load escrows");
    } finally {
      setLoadingRows(false);
    }
  }, []);

  useEffect(() => {
    if (totalCount !== null) {
      fetchPage(page, totalCount);
    }
  }, [totalCount, page, fetchPage]);

  const totalPages = totalCount !== null ? Math.ceil(totalCount / PAGE_SIZE) : 0;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Escrows</h1>
          <p className="text-gray-400 mt-1">
            {isLoadingCount
              ? "Loading…"
              : totalCount !== null
              ? `${totalCount} agreement${totalCount !== 1 ? "s" : ""} on-chain`
              : "Browse all on-chain escrow agreements"}
          </p>
        </div>
        <Link
          href="/escrow/create"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors self-start sm:self-auto"
          aria-label="Create a new escrow"
        >
          <PlusCircle className="w-4 h-4" aria-hidden="true" />
          New Escrow
        </Link>
      </div>

      {/* Jump to ID */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const id = parseInt(jumpId, 10);
          if (id > 0) window.location.href = `/escrow/${id}`;
        }}
        className="flex gap-3"
      >
        <div className="relative flex-1 max-w-sm">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
            aria-hidden="true"
          />
          <input
            type="number"
            value={jumpId}
            onChange={(e) => setJumpId(e.target.value)}
            placeholder="Jump to escrow ID…"
            min={1}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-blue-500"
            aria-label="Escrow ID to jump to"
          />
        </div>
        <button
          type="submit"
          disabled={!jumpId}
          className="px-4 py-2.5 bg-gray-800 border border-gray-700 hover:bg-gray-700 disabled:opacity-40 text-white rounded-lg text-sm transition-colors"
        >
          Go
        </button>
      </form>

      {/* Error state */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 p-4 bg-gray-900 border border-gray-700 rounded-lg text-gray-400 text-sm"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-400" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading skeleton */}
      {(isLoadingCount || isLoadingRows) && !error && (
        <div className="flex items-center justify-center py-16 text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" aria-hidden="true" />
          <span>Loading escrows…</span>
        </div>
      )}

      {/* Empty state */}
      {!isLoadingCount && !isLoadingRows && !error && totalCount === 0 && (
        <div className="card text-center py-16 space-y-4">
          <Package className="w-10 h-10 text-gray-600 mx-auto" aria-hidden="true" />
          <p className="text-gray-500">No escrows yet.</p>
          <Link
            href="/escrow/create"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <PlusCircle className="w-4 h-4" aria-hidden="true" />
            Create the first one
          </Link>
        </div>
      )}

      {/* Escrow list */}
      {!isLoadingRows && escrows.length > 0 && (
        <>
          {/* Table header — hidden on mobile */}
          <div className="hidden md:grid grid-cols-12 gap-4 px-4 text-xs text-gray-500 mb-1">
            <span className="col-span-1">#</span>
            <span className="col-span-3">Description</span>
            <span className="col-span-2">Status</span>
            <span className="col-span-2 text-right">Total</span>
            <span className="col-span-2 text-right">Released</span>
            <span className="col-span-1 text-center">Milestones</span>
            <span className="col-span-1"></span>
          </div>

          <div className="space-y-2" role="list" aria-label="Escrow list">
            {escrows.map((esc) => {
              const pct =
                esc.totalAmount !== "0"
                  ? Number(
                      (BigInt(esc.releasedAmount) * 100n) /
                        BigInt(esc.totalAmount)
                    )
                  : 0;

              return (
                <Link
                  key={esc.id}
                  href={`/escrow/${esc.id}`}
                  role="listitem"
                  className="card grid grid-cols-12 gap-4 items-center hover:border-gray-600 transition-colors group"
                  aria-label={`Escrow #${esc.id}: ${esc.description || "No description"}`}
                >
                  {/* ID */}
                  <div className="col-span-1 text-gray-500 font-mono text-sm">
                    #{esc.id}
                  </div>

                  {/* Description + addresses */}
                  <div className="col-span-3 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {esc.description || (
                        <span className="text-gray-500 italic">No description</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500 font-mono truncate mt-0.5">
                      {shortAddr(esc.client)} → {shortAddr(esc.contributor)}
                    </p>
                  </div>

                  {/* Status badge */}
                  <div className="col-span-2">
                    <span
                      className={clsx(
                        "inline-block px-2 py-0.5 rounded-full border text-xs font-medium",
                        STATUS_STYLES[esc.status]
                      )}
                    >
                      {esc.status}
                    </span>
                  </div>

                  {/* Total amount */}
                  <div className="col-span-2 text-right">
                    <span className="text-sm font-mono">
                      {formatAmount(esc.totalAmount)}
                    </span>
                  </div>

                  {/* Released + progress bar */}
                  <div className="col-span-2 text-right space-y-1">
                    <span className="text-sm font-mono text-green-400">
                      {formatAmount(esc.releasedAmount)}
                    </span>
                    <div className="w-full bg-gray-800 rounded-full h-1">
                      <div
                        className="bg-green-500 h-1 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                        role="progressbar"
                        aria-valuenow={pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${pct}% released`}
                      />
                    </div>
                  </div>

                  {/* Milestone count */}
                  <div className="col-span-1 text-center text-sm text-gray-400">
                    {esc.milestonesTotal}
                  </div>

                  {/* Arrow */}
                  <div className="col-span-1 flex justify-end">
                    <ChevronRight
                      className="w-4 h-4 text-gray-600 group-hover:text-gray-300 transition-colors"
                      aria-hidden="true"
                    />
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div
              className="flex items-center justify-center gap-4 pt-2"
              role="navigation"
              aria-label="Escrow list pagination"
            >
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-400 hover:bg-gray-700 disabled:opacity-40 transition-colors"
                aria-label="Previous page"
              >
                ← Previous
              </button>
              <span className="text-sm text-gray-500">
                Page {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-400 hover:bg-gray-700 disabled:opacity-40 transition-colors"
                aria-label="Next page"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
