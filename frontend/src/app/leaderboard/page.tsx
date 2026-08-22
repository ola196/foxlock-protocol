"use client";

/**
 * FoxPoints Leaderboard page — closes #35
 *
 * Displays contributors sorted by FoxPoints with tier badges.
 * Supports live lookups against the on-chain reputation contract,
 * with local state for search and tier filtering.
 *
 * Architecture:
 *  - Seed list of known addresses from env / static list.
 *  - Fetch each profile via queryContract (read-only, no wallet needed).
 *  - Sort by fox_points descending; assign live ranks.
 *  - Allow users to paste in additional addresses to add to the board.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  Trophy,
  Star,
  TrendingUp,
  Search,
  RefreshCw,
  Loader2,
  UserPlus,
  AlertCircle,
} from "lucide-react";
import {
  queryContract,
  REPUTATION_CONTRACT_ID,
  toAddress,
} from "@/lib/stellar";
import { xdr } from "@stellar/stellar-sdk";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tier = "Cub" | "Fox" | "Senior" | "Elite";

interface ContributorProfile {
  fox_points: number;
  milestones_completed: number;
  milestones_rejected: number;
  tier: Tier;
  last_updated: number;
}

interface LeaderboardEntry {
  rank: number;
  address: string;
  profile: ContributorProfile;
}

type LoadStatus = "idle" | "loading" | "success" | "error";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Well-known addresses to pre-populate the leaderboard on mount. */
const SEED_ADDRESSES: string[] = (
  process.env.NEXT_PUBLIC_LEADERBOARD_SEEDS ?? ""
)
  .split(",")
  .map((a) => a.trim())
  .filter((a) => a.startsWith("G") && a.length >= 56);

const TIER_STYLES: Record<Tier, string> = {
  Cub:    "text-gray-400   bg-gray-800       border-gray-700",
  Fox:    "text-orange-300 bg-orange-900/30  border-orange-700",
  Senior: "text-purple-300 bg-purple-900/30  border-purple-700",
  Elite:  "text-yellow-300 bg-yellow-900/30  border-yellow-700",
};

const TIER_ICONS: Record<Tier, string> = {
  Cub:    "🦊",
  Fox:    "🦊✨",
  Senior: "🦊⭐",
  Elite:  "🦊👑",
};

const TIER_BAR_COLOR: Record<Tier, string> = {
  Cub:    "bg-gray-500",
  Fox:    "bg-orange-500",
  Senior: "bg-purple-500",
  Elite:  "bg-yellow-500",
};

const RANK_MEDALS = ["🥇", "🥈", "🥉"];

const TIERS: { name: Tier; min: number; max: number | null; color: string }[] = [
  { name: "Cub",    min: 0,    max: 99,   color: "bg-gray-600"   },
  { name: "Fox",    min: 100,  max: 499,  color: "bg-orange-600" },
  { name: "Senior", min: 500,  max: 1999, color: "bg-purple-600" },
  { name: "Elite",  min: 2000, max: null, color: "bg-yellow-600" },
];

// ── ScVal parser ──────────────────────────────────────────────────────────────

function parseProfile(val: xdr.ScVal): ContributorProfile {
  const map = val.map();
  if (!map) throw new Error("Expected map ScVal for ContributorProfile");

  const obj: Record<string, xdr.ScVal> = {};
  for (const entry of map) {
    obj[entry.key().sym().toString()] = entry.val();
  }

  const getU64 = (key: string): number => {
    const v = obj[key];
    if (!v) return 0;
    try { return Number(v.u64().toBigInt()); } catch { return 0; }
  };

  const getU32 = (key: string): number => {
    const v = obj[key];
    if (!v) return 0;
    try { return v.u32(); } catch { return 0; }
  };

  // Tier is returned as a Soroban enum — first entry of the vec or a sym
  const parseTier = (): Tier => {
    const v = obj["tier"];
    if (!v) return "Cub";
    try {
      const sym = v.vec()?.[0]?.sym()?.toString() ?? v.sym()?.toString();
      if (sym === "Fox")    return "Fox";
      if (sym === "Senior") return "Senior";
      if (sym === "Elite")  return "Elite";
    } catch { /* fall through */ }
    return "Cub";
  };

  return {
    fox_points:            getU64("fox_points"),
    milestones_completed:  getU32("milestones_completed"),
    milestones_rejected:   getU32("milestones_rejected"),
    tier:                  parseTier(),
    last_updated:          getU32("last_updated"),
  };
}

// ── Hook: fetch one profile ───────────────────────────────────────────────────

async function fetchProfile(address: string): Promise<ContributorProfile> {
  return queryContract(
    REPUTATION_CONTRACT_ID,
    "get_profile",
    [toAddress(address)],
    parseProfile,
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function LeaderboardPage() {
  const [entries, setEntries]         = useState<LeaderboardEntry[]>([]);
  const [status, setStatus]           = useState<LoadStatus>("idle");
  const [loadError, setLoadError]     = useState<string | null>(null);
  const [search, setSearch]           = useState("");
  const [filterTier, setFilterTier]   = useState<Tier | "all">("all");
  const [addInput, setAddInput]       = useState("");
  const [addError, setAddError]       = useState<string | null>(null);
  const [isAdding, setIsAdding]       = useState(false);
  const [trackedAddrs, setTrackedAddrs] = useState<string[]>(SEED_ADDRESSES);

  /** Fetch profiles for all tracked addresses and rebuild the ranked list. */
  const loadLeaderboard = useCallback(async () => {
    if (trackedAddrs.length === 0) {
      setEntries([]);
      setStatus("success");
      return;
    }

    setStatus("loading");
    setLoadError(null);

    try {
      const results = await Promise.allSettled(
        trackedAddrs.map((addr) => fetchProfile(addr))
      );

      const loaded: { address: string; profile: ContributorProfile }[] = [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === "fulfilled") {
          loaded.push({ address: trackedAddrs[i], profile: r.value });
        }
        // silently skip unfulfilled (address has no profile yet)
      }

      // Sort descending by FoxPoints, assign ranks
      loaded.sort((a, b) => b.profile.fox_points - a.profile.fox_points);
      setEntries(
        loaded.map((item, i) => ({ rank: i + 1, ...item }))
      );
      setStatus("success");
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load leaderboard"
      );
      setStatus("error");
    }
  }, [trackedAddrs]);

  useEffect(() => {
    loadLeaderboard();
  }, [loadLeaderboard]);

  /** Add a new address to the board. */
  const handleAddAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    const addr = addInput.trim();

    if (!addr.startsWith("G") || addr.length < 56) {
      setAddError("Enter a valid Stellar address (starts with G, 56+ chars).");
      return;
    }
    if (trackedAddrs.includes(addr)) {
      setAddError("Address is already on the leaderboard.");
      return;
    }

    setIsAdding(true);
    setAddError(null);

    try {
      await fetchProfile(addr); // verify it exists before adding
      setTrackedAddrs((prev) => [...prev, addr]);
      setAddInput("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAddError(
        msg.includes("NotFound")
          ? "No on-chain profile found for that address."
          : `Could not fetch profile: ${msg}`
      );
    } finally {
      setIsAdding(false);
    }
  };

  // ── Filtering ───────────────────────────────────────────────────────────────

  const filtered = entries.filter((e) => {
    if (filterTier !== "all" && e.profile.tier !== filterTier) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!e.address.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const topPoints = entries[0]?.profile.fox_points ?? 1;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Trophy className="w-8 h-8 text-yellow-400" aria-hidden="true" />
          FoxPoints Leaderboard
        </h1>
        <p className="text-gray-400 mt-2">
          Top contributors ranked by FoxPoints. Every approved milestone earns
          points and builds your tier — stored on Stellar, verifiable by anyone.
        </p>
      </div>

      {/* Tier system overview / filter */}
      <div
        className="grid grid-cols-2 md:grid-cols-4 gap-3"
        role="group"
        aria-label="Filter by tier"
      >
        {TIERS.map(({ name, min, max, color }) => (
          <button
            key={name}
            onClick={() => setFilterTier(filterTier === name ? "all" : name)}
            aria-pressed={filterTier === name}
            className={clsx(
              "card text-center cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500",
              filterTier === name
                ? "border-violet-500 shadow-lg shadow-violet-900/20"
                : "hover:border-gray-600"
            )}
          >
            <div className="text-2xl mb-1" aria-hidden="true">
              {TIER_ICONS[name]}
            </div>
            <div className="font-semibold text-sm">{name}</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {max != null ? `${min}–${max} pts` : `${min}+ pts`}
            </div>
            <div className={clsx("h-1 rounded-full mt-2", color)} />
          </button>
        ))}
      </div>

      {/* Search bar + refresh */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
            aria-hidden="true"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by address…"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-violet-500"
            aria-label="Search contributors by address"
          />
        </div>
        {(search || filterTier !== "all") && (
          <button
            onClick={() => { setSearch(""); setFilterTier("all"); }}
            className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-400 hover:bg-gray-700 transition-colors"
            aria-label="Clear filters"
          >
            Reset
          </button>
        )}
        <button
          onClick={loadLeaderboard}
          disabled={status === "loading"}
          className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-400 hover:bg-gray-700 transition-colors flex items-center gap-2 disabled:opacity-50"
          aria-label="Refresh leaderboard"
        >
          {status === "loading" ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
          )}
          Refresh
        </button>
      </div>

      {/* Error banner */}
      {status === "error" && (
        <div
          role="alert"
          className="flex items-start gap-3 p-4 bg-red-900/20 border border-red-800 rounded-xl text-red-300 text-sm"
        >
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-semibold">Failed to load leaderboard</p>
            {loadError && <p className="mt-0.5 text-red-400">{loadError}</p>}
            <button
              onClick={loadLeaderboard}
              className="mt-2 underline hover:text-red-200"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {status === "loading" && entries.length === 0 && (
        <div className="space-y-2" aria-label="Loading leaderboard" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="card animate-pulse h-16 bg-gray-900"
            />
          ))}
        </div>
      )}

      {/* Leaderboard table */}
      {(status === "success" || (status === "loading" && entries.length > 0)) && (
        <div className="space-y-2">
          {/* Column headers (desktop) */}
          <div
            className="hidden md:grid grid-cols-12 gap-4 px-4 text-xs text-gray-500 mb-1"
            aria-hidden="true"
          >
            <span className="col-span-1">Rank</span>
            <span className="col-span-4">Address</span>
            <span className="col-span-2">Tier</span>
            <span className="col-span-2 text-right">FoxPoints</span>
            <span className="col-span-2 text-right">Completed</span>
            <span className="col-span-1 text-right">Rejected</span>
          </div>

          {filtered.map((entry) => (
            <article
              key={entry.address}
              className={clsx(
                "card grid grid-cols-12 gap-4 items-center",
                entry.rank <= 3 && "border-yellow-900/40"
              )}
              aria-label={`Rank ${entry.rank}: ${entry.address}`}
            >
              {/* Rank */}
              <div
                className={clsx(
                  "col-span-1 text-lg font-bold",
                  entry.rank === 1 && "text-yellow-400",
                  entry.rank === 2 && "text-gray-400",
                  entry.rank === 3 && "text-orange-500",
                  entry.rank > 3  && "text-gray-600"
                )}
              >
                {entry.rank <= 3
                  ? RANK_MEDALS[entry.rank - 1]
                  : `#${entry.rank}`}
              </div>

              {/* Address */}
              <div className="col-span-4">
                <Link
                  href={`/reputation?address=${entry.address}`}
                  className="text-sm font-mono text-gray-300 hover:text-white hover:underline transition-colors truncate block max-w-full"
                  title={entry.address}
                  aria-label={`View profile for ${entry.address}`}
                >
                  {entry.address.slice(0, 6)}…{entry.address.slice(-6)}
                </Link>
              </div>

              {/* Tier badge */}
              <div className="col-span-2">
                <span
                  className={clsx(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold",
                    TIER_STYLES[entry.profile.tier]
                  )}
                  aria-label={`Tier: ${entry.profile.tier}`}
                >
                  <span aria-hidden="true">{TIER_ICONS[entry.profile.tier]}</span>
                  {entry.profile.tier}
                </span>
              </div>

              {/* FoxPoints + progress bar */}
              <div className="col-span-2 text-right">
                <div className="flex items-center justify-end gap-1.5">
                  <Star className="w-3 h-3 text-yellow-400" aria-hidden="true" />
                  <span className="font-bold text-yellow-400">
                    {entry.profile.fox_points.toLocaleString()}
                  </span>
                </div>
                <div
                  className="w-full bg-gray-800 rounded-full h-1 mt-1"
                  role="progressbar"
                  aria-label={`${entry.profile.fox_points} FoxPoints`}
                  aria-valuenow={entry.profile.fox_points}
                  aria-valuemin={0}
                  aria-valuemax={topPoints}
                >
                  <div
                    className={clsx("h-1 rounded-full transition-all", TIER_BAR_COLOR[entry.profile.tier])}
                    style={{
                      width: `${Math.min(
                        (entry.profile.fox_points / topPoints) * 100,
                        100
                      )}%`,
                    }}
                  />
                </div>
              </div>

              {/* Completed */}
              <div className="col-span-2 text-right">
                <div className="flex items-center justify-end gap-1 text-green-400">
                  <TrendingUp className="w-3 h-3" aria-hidden="true" />
                  <span className="font-semibold">
                    {entry.profile.milestones_completed}
                  </span>
                </div>
              </div>

              {/* Rejected */}
              <div className="col-span-1 text-right text-gray-500 text-sm">
                {entry.profile.milestones_rejected}
              </div>
            </article>
          ))}

          {/* Empty state after filter */}
          {filtered.length === 0 && status === "success" && (
            <div className="card text-center text-gray-500 py-12">
              {trackedAddrs.length === 0 ? (
                <p>
                  No contributors tracked yet.{" "}
                  <span className="text-gray-400">
                    Add an address below to get started.
                  </span>
                </p>
              ) : (
                <p>No contributors match your search or filter.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Add address panel */}
      <section className="card" aria-labelledby="add-address-heading">
        <h2
          id="add-address-heading"
          className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2"
        >
          <UserPlus className="w-4 h-4" aria-hidden="true" />
          Track a contributor
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          Enter any Stellar address to fetch their on-chain reputation profile
          and add them to the leaderboard.
        </p>
        <form onSubmit={handleAddAddress} className="flex gap-3" noValidate>
          <input
            type="text"
            value={addInput}
            onChange={(e) => { setAddInput(e.target.value); setAddError(null); }}
            placeholder="G... (Stellar address)"
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-violet-500"
            aria-label="Stellar address to add to the leaderboard"
            aria-describedby={addError ? "add-error" : undefined}
          />
          <button
            type="submit"
            disabled={isAdding || !addInput.trim()}
            className="px-4 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-lg text-sm flex items-center gap-2 transition-colors"
            aria-label="Add contributor to leaderboard"
          >
            {isAdding ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <UserPlus className="w-4 h-4" aria-hidden="true" />
            )}
            Add
          </button>
        </form>
        {addError && (
          <p
            id="add-error"
            role="alert"
            className="mt-2 text-xs text-red-400 flex items-center gap-1"
          >
            <AlertCircle className="w-3 h-3" aria-hidden="true" />
            {addError}
          </p>
        )}
      </section>

      {/* Footer */}
      <p className="text-center text-xs text-gray-600">
        Rankings are sourced live from the Stellar reputation contract.{" "}
        <Link
          href="/reputation"
          className="text-violet-400 hover:underline"
          aria-label="Look up any contributor address"
        >
          Look up any address →
        </Link>
      </p>
    </div>
  );
}
