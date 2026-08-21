"use client";

/**
 * Escrow Dashboard — /dashboard
 *
 * Wallet-scoped view: shows all on-chain escrows where the connected
 * address appears as either client or contributor.
 *
 * Strategy: the Soroban escrow contract stores records by sequential ID
 * with no on-chain address index, so we scan all IDs in parallel batches
 * and filter by the connected address client-side. This is fast enough
 * for the current escrow count range and avoids any off-chain indexer
 * dependency.
 *
 * Features:
 *   - Summary stats: total locked, total released, active, completed
 *   - Role tabs: All / As Client / As Contributor
 *   - Status filter chips: All / Active / Completed / Disputed / Cancelled
 *   - Link-out to each escrow's detail page
 *   - Prompt to connect wallet if not connected
 *
 * Closes #32
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Loader2,
  AlertCircle,
  Wallet,
  PlusCircle,
  ChevronRight,
  LayoutDashboard,
  TrendingUp,
  Lock,
  CheckCircle2,
  Gavel,
  Users,
  Briefcase,
} from "lucide-react";
import clsx from "clsx";
import { xdr } from "@stellar/stellar-sdk";
import { queryContract, ESCROW_CONTRACT_ID, toU64 } from "@/lib/stellar";
import { useWalletStore } from "@/store/walletStore";

// ─── Types ────────────────────────────────────────────────────────────────────

type EscrowStatus = "Active" | "Completed" | "Disputed" | "Cancelled";
type RoleFilter   = "all" | "client" | "contributor";
type StatusFilter = "all" | EscrowStatus;

interface EscrowSummary {
  id: number;
  status: EscrowStatus;
  description: string;
  totalAmount: bigint;
  releasedAmount: bigint;
  milestonesTotal: number;
  milestonesApproved: number;
  client: string;
  contributor: string;
}

// ─── ScVal parsing helpers ────────────────────────────────────────────────────

function scStr(v: xdr.ScVal): string {
  try {
    if (v.switch().name === "scvString") return v.str().toString();
    if (v.switch().name === "scvSymbol") return v.sym().toString();
  } catch { /* ignore */ }
  return "";
}

function scAddr(v: xdr.ScVal): string {
  try {
    if (v.switch().name === "scvAddress") {
      const a = v.address();
      if (a.switch().name === "scAddressTypeAccount") {
        return a.accountId().publicKey().toString();
      }
    }
  } catch { /* ignore */ }
  return "";
}

function scI128(v: xdr.ScVal): bigint {
  try {
    if (v.switch().name === "scvI128") {
      const hi = BigInt(v.i128().hi().toString());
      const lo = BigInt(v.i128().lo().toString());
      return (hi << 64n) | lo;
    }
  } catch { /* ignore */ }
  return 0n;
}

function scStatus(v: xdr.ScVal): EscrowStatus {
  try {
    if (v.switch().name === "scvVec") {
      const vec = v.vec();
      if (vec && vec.length > 0) return vec[0].sym().toString() as EscrowStatus;
    }
  } catch { /* ignore */ }
  return "Active";
}

function scMilestones(v: xdr.ScVal): { total: number; approved: number } {
  try {
    if (v.switch().name === "scvVec") {
      const vec = v.vec();
      if (!vec) return { total: 0, approved: 0 };
      let approved = 0;
      for (const m of vec) {
        try {
          const mmap = m.map();
          if (mmap) {
            for (const e of mmap) {
              const k = e.key().switch().name === "scvSymbol"
                ? e.key().sym().toString() : "";
              if (k === "status") {
                const s = scStatus(e.val());
                if (s === "Approved") approved++;
              }
            }
          }
        } catch { /* ignore */ }
      }
      return { total: vec.length, approved };
    }
  } catch { /* ignore */ }
  return { total: 0, approved: 0 };
}

function parseRecord(val: xdr.ScVal, id: number): EscrowSummary {
  const map = val.map();
  if (!map) throw new Error("Expected ScVal map");
  const d: Record<string, xdr.ScVal> = {};
  for (const e of map) {
    const k = e.key().switch().name === "scvSymbol"
      ? e.key().sym().toString()
      : e.key().str().toString();
    d[k] = e.val();
  }
  const { total, approved } = scMilestones(d["milestones"]);
  return {
    id,
    status:             scStatus(d["status"]),
    description:        scStr(d["description"]),
    totalAmount:        scI128(d["total_amount"]),
    releasedAmount:     scI128(d["released_amount"]),
    milestonesTotal:    total,
    milestonesApproved: approved,
    client:             scAddr(d["client"]),
    contributor:        scAddr(d["contributor"]),
  };
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

/** Convert raw i128 (×1e7 stroops) to human-readable token string */
function fmtTokens(raw: bigint): string {
  if (raw === 0n) return "0";
  const whole = raw / BigInt(1e7);
  const frac  = raw % BigInt(1e7);
  if (frac === 0n) return whole.toLocaleString();
  return `${whole.toLocaleString()}.${frac.toString().padStart(7, "0").replace(/0+$/, "")}`;
}

function shortAddr(addr: string): string {
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// ─── Style maps ───────────────────────────────────────────────────────────────

const STATUS_PILL: Record<EscrowStatus, string> = {
  Active:    "text-blue-300 bg-blue-900/30 border-blue-700",
  Completed: "text-green-300 bg-green-900/30 border-green-700",
  Disputed:  "text-red-300 bg-red-900/30 border-red-700",
  Cancelled: "text-gray-400 bg-gray-800 border-gray-700",
};

const STATUS_BAR: Record<EscrowStatus, string> = {
  Active:    "bg-blue-500",
  Completed: "bg-green-500",
  Disputed:  "bg-red-500",
  Cancelled: "bg-gray-600",
};

// How many escrows to fetch per batch (parallel requests)
const BATCH_SIZE = 20;

// ─── Main component ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { address, connect } = useWalletStore();

  // Scan state
  const [myEscrows, setMyEscrows]       = useState<EscrowSummary[]>([]);
  const [isScanning, setIsScanning]     = useState(false);
  const [scanProgress, setScanProgress] = useState(0);  // 0-100
  const [scanTotal, setScanTotal]       = useState(0);
  const [scanError, setScanError]       = useState<string | null>(null);
  const [lastScanned, setLastScanned]   = useState<string | null>(null);

  // Filter state
  const [roleFilter, setRoleFilter]     = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // ── Scan all escrows for this wallet ──────────────────────────────────────
  const scan = useCallback(async (walletAddress: string) => {
    setIsScanning(true);
    setScanError(null);
    setMyEscrows([]);
    setScanProgress(0);

    try {
      // 1. Get total count
      const total = await queryContract<number>(
        ESCROW_CONTRACT_ID,
        "get_escrow_count",
        [],
        (val) => {
          try { return parseInt(val.u64().toString(), 10); } catch { return 0; }
        }
      );
      setScanTotal(total);

      if (total === 0) {
        setIsScanning(false);
        setScanProgress(100);
        return;
      }

      // 2. Fetch all in batches, filter by wallet
      const found: EscrowSummary[] = [];
      let fetched = 0;

      for (let start = 1; start <= total; start += BATCH_SIZE) {
        const end = Math.min(start + BATCH_SIZE - 1, total);
        const ids = Array.from({ length: end - start + 1 }, (_, i) => start + i);

        const results = await Promise.allSettled(
          ids.map((id) =>
            queryContract<EscrowSummary>(
              ESCROW_CONTRACT_ID,
              "get_escrow",
              [toU64(id)],
              (val) => parseRecord(val, id)
            )
          )
        );

        for (const r of results) {
          if (r.status === "fulfilled") {
            const e = r.value;
            if (e.client === walletAddress || e.contributor === walletAddress) {
              found.push(e);
            }
          }
        }

        fetched += ids.length;
        setScanProgress(Math.round((fetched / total) * 100));
        // Yield to React between batches so progress updates render
        await new Promise((res) => setTimeout(res, 0));
      }

      // Sort: active first, then newest ID first
      found.sort((a, b) => {
        const order: Record<EscrowStatus, number> = {
          Active: 0, Disputed: 1, Completed: 2, Cancelled: 3,
        };
        if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
        return b.id - a.id;
      });

      setMyEscrows(found);
      setLastScanned(new Date().toLocaleTimeString());
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Failed to scan escrows");
    } finally {
      setIsScanning(false);
    }
  }, []);

  // Auto-scan when wallet connects
  useEffect(() => {
    if (address) scan(address);
  }, [address, scan]);

  // ── Derived filtered list ─────────────────────────────────────────────────
  const filtered = myEscrows.filter((e) => {
    if (roleFilter === "client"      && e.client      !== address) return false;
    if (roleFilter === "contributor" && e.contributor !== address) return false;
    if (statusFilter !== "all"       && e.status      !== statusFilter) return false;
    return true;
  });

  // ── Summary stats ─────────────────────────────────────────────────────────
  const stats = myEscrows.reduce(
    (acc, e) => {
      acc.totalLocked    += e.totalAmount - e.releasedAmount;
      acc.totalReleased  += e.releasedAmount;
      if (e.status === "Active")    acc.active++;
      if (e.status === "Completed") acc.completed++;
      if (e.status === "Disputed")  acc.disputed++;
      return acc;
    },
    { totalLocked: 0n, totalReleased: 0n, active: 0, completed: 0, disputed: 0 }
  );

  const clientCount      = myEscrows.filter((e) => e.client      === address).length;
  const contributorCount = myEscrows.filter((e) => e.contributor === address).length;

  // ─── Render ───────────────────────────────────────────────────────────────

  // Not connected
  if (!address) {
    return (
      <div className="max-w-lg mx-auto pt-16 text-center space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-blue-900/30 border border-blue-800 flex items-center justify-center mx-auto">
          <LayoutDashboard className="w-8 h-8 text-blue-400" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">My Dashboard</h1>
          <p className="text-gray-400 mt-2">
            Connect your Stellar wallet to see all escrows tied to your address.
          </p>
        </div>
        <button
          onClick={connect}
          className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors"
          aria-label="Connect Stellar wallet"
        >
          <Wallet className="w-5 h-5" aria-hidden="true" />
          Connect Wallet
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <LayoutDashboard className="w-7 h-7 text-blue-400" aria-hidden="true" />
            My Dashboard
          </h1>
          <p className="text-gray-400 mt-1 text-sm font-mono">
            {shortAddr(address)}
            {lastScanned && (
              <span className="ml-3 text-gray-600 font-sans">
                · scanned at {lastScanned}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-3 self-start sm:self-auto">
          <button
            onClick={() => scan(address)}
            disabled={isScanning}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-800 border border-gray-700 hover:bg-gray-700 disabled:opacity-40 text-gray-300 rounded-lg text-sm transition-colors"
            aria-label="Refresh dashboard"
          >
            {isScanning ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <TrendingUp className="w-4 h-4" aria-hidden="true" />
            )}
            Refresh
          </button>
          <Link
            href="/escrow/create"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
            aria-label="Create a new escrow"
          >
            <PlusCircle className="w-4 h-4" aria-hidden="true" />
            New Escrow
          </Link>
        </div>
      </div>

      {/* ── Scan progress bar ─────────────────────────────────────────────── */}
      {isScanning && (
        <div className="space-y-2" role="status" aria-live="polite">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span className="flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
              Scanning on-chain escrows…
            </span>
            <span>{scanProgress}% of {scanTotal}</span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-1.5">
            <div
              className="bg-blue-500 h-1.5 rounded-full transition-all duration-200"
              style={{ width: `${scanProgress}%` }}
              role="progressbar"
              aria-valuenow={scanProgress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Scan progress"
            />
          </div>
        </div>
      )}

      {/* ── Error state ───────────────────────────────────────────────────── */}
      {scanError && (
        <div
          role="alert"
          className="flex items-start gap-3 p-4 bg-gray-900 border border-gray-700 rounded-lg text-gray-400 text-sm"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-400" aria-hidden="true" />
          <span>{scanError}</span>
        </div>
      )}

      {/* ── Summary stats ─────────────────────────────────────────────────── */}
      {!isScanning && myEscrows.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Total locked */}
          <div className="card space-y-1">
            <div className="flex items-center gap-2 text-xs text-gray-500 uppercase tracking-wider mb-2">
              <Lock className="w-3.5 h-3.5" aria-hidden="true" />
              Locked
            </div>
            <p className="text-2xl font-bold font-mono text-white">
              {fmtTokens(stats.totalLocked)}
            </p>
            <p className="text-xs text-gray-500">tokens in escrow</p>
          </div>

          {/* Total released */}
          <div className="card space-y-1">
            <div className="flex items-center gap-2 text-xs text-gray-500 uppercase tracking-wider mb-2">
              <TrendingUp className="w-3.5 h-3.5" aria-hidden="true" />
              Released
            </div>
            <p className="text-2xl font-bold font-mono text-green-400">
              {fmtTokens(stats.totalReleased)}
            </p>
            <p className="text-xs text-gray-500">tokens paid out</p>
          </div>

          {/* Active count */}
          <div className="card space-y-1">
            <div className="flex items-center gap-2 text-xs text-gray-500 uppercase tracking-wider mb-2">
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
              Active
            </div>
            <p className="text-2xl font-bold text-blue-400">
              {stats.active}
              {stats.disputed > 0 && (
                <span className="ml-2 text-sm text-red-400">
                  {stats.disputed} disputed
                </span>
              )}
            </p>
            <p className="text-xs text-gray-500">
              {stats.completed} completed
            </p>
          </div>

          {/* Role split */}
          <div className="card space-y-1">
            <div className="flex items-center gap-2 text-xs text-gray-500 uppercase tracking-wider mb-2">
              <Users className="w-3.5 h-3.5" aria-hidden="true" />
              Roles
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400 flex items-center gap-1">
                  <Briefcase className="w-3 h-3" aria-hidden="true" /> Client
                </span>
                <span className="text-sm font-bold text-white">{clientCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400 flex items-center gap-1">
                  <Gavel className="w-3 h-3" aria-hidden="true" /> Contributor
                </span>
                <span className="text-sm font-bold text-white">{contributorCount}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Role tabs + Status filter ─────────────────────────────────────── */}
      {!isScanning && myEscrows.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          {/* Role tabs */}
          <div
            className="flex gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1"
            role="tablist"
            aria-label="Filter by role"
          >
            {(
              [
                { key: "all",         label: `All (${myEscrows.length})` },
                { key: "client",      label: `Client (${clientCount})` },
                { key: "contributor", label: `Contributor (${contributorCount})` },
              ] as { key: RoleFilter; label: string }[]
            ).map(({ key, label }) => (
              <button
                key={key}
                role="tab"
                aria-selected={roleFilter === key}
                onClick={() => setRoleFilter(key)}
                className={clsx(
                  "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  roleFilter === key
                    ? "bg-gray-700 text-white"
                    : "text-gray-400 hover:text-white"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Status filter chips */}
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
            {(
              [
                { key: "all",       label: "All" },
                { key: "Active",    label: "Active" },
                { key: "Completed", label: "Completed" },
                { key: "Disputed",  label: "Disputed" },
                { key: "Cancelled", label: "Cancelled" },
              ] as { key: StatusFilter; label: string }[]
            ).map(({ key, label }) => {
              const count =
                key === "all"
                  ? myEscrows.length
                  : myEscrows.filter((e) =>
                      (roleFilter === "all"         || e[roleFilter] === address) &&
                      e.status === key
                    ).length;
              return (
                <button
                  key={key}
                  onClick={() => setStatusFilter(key)}
                  aria-pressed={statusFilter === key}
                  className={clsx(
                    "px-3 py-1 rounded-full border text-xs font-medium transition-colors",
                    statusFilter === key
                      ? key === "all"
                        ? "bg-gray-600 border-gray-500 text-white"
                        : STATUS_PILL[key as EscrowStatus]
                      : "border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300"
                  )}
                >
                  {label} {count > 0 && <span className="opacity-70">({count})</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Empty states ──────────────────────────────────────────────────── */}
      {!isScanning && !scanError && myEscrows.length === 0 && scanProgress === 100 && (
        <div className="card text-center py-16 space-y-4">
          <LayoutDashboard className="w-10 h-10 text-gray-700 mx-auto" aria-hidden="true" />
          <p className="text-gray-500 font-medium">No escrows found for this wallet.</p>
          <p className="text-gray-600 text-sm">
            Create one or ask a client to invite you as a contributor.
          </p>
          <Link
            href="/escrow/create"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <PlusCircle className="w-4 h-4" aria-hidden="true" />
            Create Escrow
          </Link>
        </div>
      )}

      {!isScanning && filtered.length === 0 && myEscrows.length > 0 && (
        <div className="card text-center py-10 text-gray-500 text-sm">
          No escrows match the selected filters.
          <button
            onClick={() => { setRoleFilter("all"); setStatusFilter("all"); }}
            className="ml-2 text-blue-400 hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* ── Escrow list ───────────────────────────────────────────────────── */}
      {!isScanning && filtered.length > 0 && (
        <div className="space-y-3" role="list" aria-label="Your escrows">
          {/* Column headers — hidden on mobile */}
          <div className="hidden md:grid grid-cols-12 gap-4 px-4 text-xs text-gray-500">
            <span className="col-span-1">#</span>
            <span className="col-span-1">Role</span>
            <span className="col-span-3">Description</span>
            <span className="col-span-2">Status</span>
            <span className="col-span-2 text-right">Locked</span>
            <span className="col-span-2 text-right">Released</span>
            <span className="col-span-1 text-center">Milestones</span>
          </div>

          {filtered.map((esc) => {
            const role    = esc.client === address ? "Client" : "Contributor";
            const locked  = esc.totalAmount - esc.releasedAmount;
            const pct     = esc.totalAmount > 0n
              ? Number((esc.releasedAmount * 100n) / esc.totalAmount)
              : 0;

            return (
              <Link
                key={esc.id}
                href={`/escrow/${esc.id}`}
                role="listitem"
                className={clsx(
                  "card grid grid-cols-12 gap-4 items-center group hover:border-gray-600 transition-colors",
                  esc.status === "Disputed"  && "border-red-900/60",
                  esc.status === "Active"    && esc.milestonesApproved > 0 && "border-blue-900/40"
                )}
                aria-label={`Escrow #${esc.id} — ${role} — ${esc.status}`}
              >
                {/* ID */}
                <div className="col-span-1 font-mono text-sm text-gray-500">
                  #{esc.id}
                </div>

                {/* Role badge */}
                <div className="col-span-1">
                  <span
                    className={clsx(
                      "inline-block px-1.5 py-0.5 rounded text-xs font-semibold",
                      role === "Client"
                        ? "bg-violet-900/40 text-violet-300 border border-violet-700"
                        : "bg-teal-900/40 text-teal-300 border border-teal-700"
                    )}
                  >
                    {role === "Client" ? "C" : "W"}
                  </span>
                </div>

                {/* Description + counterparty */}
                <div className="col-span-3 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {esc.description || (
                      <span className="text-gray-500 italic">No description</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500 font-mono truncate mt-0.5">
                    {role === "Client"
                      ? `→ ${shortAddr(esc.contributor)}`
                      : `← ${shortAddr(esc.client)}`}
                  </p>
                </div>

                {/* Status badge */}
                <div className="col-span-2">
                  <span
                    className={clsx(
                      "inline-block px-2 py-0.5 rounded-full border text-xs font-medium",
                      STATUS_PILL[esc.status]
                    )}
                  >
                    {esc.status}
                  </span>
                </div>

                {/* Locked amount */}
                <div className="col-span-2 text-right">
                  <span className="text-sm font-mono text-white">
                    {fmtTokens(locked)}
                  </span>
                </div>

                {/* Released + progress bar */}
                <div className="col-span-2 text-right space-y-1">
                  <span className="text-sm font-mono text-green-400">
                    {fmtTokens(esc.releasedAmount)}
                  </span>
                  <div className="w-full bg-gray-800 rounded-full h-1">
                    <div
                      className={clsx("h-1 rounded-full transition-all", STATUS_BAR[esc.status])}
                      style={{ width: `${pct}%` }}
                      role="progressbar"
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${pct}% released`}
                    />
                  </div>
                </div>

                {/* Milestone progress */}
                <div className="col-span-1 text-center">
                  <span className="text-xs text-gray-400">
                    {esc.milestonesApproved}/{esc.milestonesTotal}
                  </span>
                </div>

                {/* Arrow */}
                <ChevronRight
                  className="w-4 h-4 text-gray-600 group-hover:text-gray-300 transition-colors col-span-0 justify-self-end hidden md:block"
                  aria-hidden="true"
                />
              </Link>
            );
          })}
        </div>
      )}

      {/* Legend */}
      {!isScanning && filtered.length > 0 && (
        <div className="flex items-center gap-6 text-xs text-gray-600 pt-2">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded bg-violet-900/60 border border-violet-700" />
            C = Client (you funded the escrow)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded bg-teal-900/60 border border-teal-700" />
            W = Worker / Contributor
          </span>
        </div>
      )}
    </div>
  );
}
