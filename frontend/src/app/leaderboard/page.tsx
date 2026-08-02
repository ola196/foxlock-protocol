"use client";

/**
 * FoxPoints Leaderboard page — closes #42
 * Shows contributors ranked by FoxPoints with tier badges.
 */

import { useState } from "react";
import clsx from "clsx";
import { Star, Trophy, TrendingUp, Search } from "lucide-react";

interface LeaderboardEntry {
  rank: number;
  address: string;
  displayName: string;
  foxPoints: number;
  tier: "Cub" | "Fox" | "Senior" | "Elite";
  completed: number;
  rejected: number;
}

const MOCK_DATA: LeaderboardEntry[] = [
  { rank: 1, address: "GABC...1234", displayName: "alice.stellar", foxPoints: 2450, tier: "Elite", completed: 28, rejected: 2 },
  { rank: 2, address: "GXYZ...5678", displayName: "bobbuilder", foxPoints: 1820, tier: "Senior", completed: 21, rejected: 3 },
  { rank: 3, address: "GDEF...9012", displayName: "carol.dev", foxPoints: 950, tier: "Senior", completed: 14, rejected: 1 },
  { rank: 4, address: "GHIJ...3456", displayName: "dave.web3", foxPoints: 540, tier: "Senior", completed: 8, rejected: 4 },
  { rank: 5, address: "GKLM...7890", displayName: "eve.stellar", foxPoints: 320, tier: "Fox", completed: 5, rejected: 0 },
  { rank: 6, address: "GNOP...2345", displayName: "frank.chain", foxPoints: 180, tier: "Fox", completed: 3, rejected: 1 },
  { rank: 7, address: "GQRS...6789", displayName: "grace.build", foxPoints: 95, tier: "Cub", completed: 2, rejected: 2 },
  { rank: 8, address: "GTUV...0123", displayName: "henry.dev", foxPoints: 40, tier: "Cub", completed: 1, rejected: 0 },
];

const TIER_STYLES: Record<string, string> = {
  Cub:    "text-gray-400 bg-gray-800 border-gray-700",
  Fox:    "text-orange-300 bg-orange-900/30 border-orange-700",
  Senior: "text-purple-300 bg-purple-900/30 border-purple-700",
  Elite:  "text-yellow-300 bg-yellow-900/30 border-yellow-700",
};

const TIER_ICONS: Record<string, string> = {
  Cub: "🦊", Fox: "🦊✨", Senior: "🦊⭐", Elite: "🦊👑",
};

const RANK_COLORS = ["text-yellow-400", "text-gray-400", "text-orange-500"];

const TIERS = [
  { name: "Cub",    min: 0,    max: 99,   color: "bg-gray-700" },
  { name: "Fox",    min: 100,  max: 499,  color: "bg-orange-700" },
  { name: "Senior", min: 500,  max: 1999, color: "bg-purple-700" },
  { name: "Elite",  min: 2000, max: null, color: "bg-yellow-700" },
];

export default function LeaderboardPage() {
  const [search, setSearch] = useState("");
  const [filterTier, setFilterTier] = useState<"all" | "Cub" | "Fox" | "Senior" | "Elite">("all");

  const filtered = MOCK_DATA.filter((e) => {
    if (filterTier !== "all" && e.tier !== filterTier) return false;
    if (search && !e.displayName.toLowerCase().includes(search.toLowerCase()) &&
        !e.address.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Trophy className="w-8 h-8 text-yellow-400" aria-hidden="true" />
          FoxPoints Leaderboard
        </h1>
        <p className="text-gray-400 mt-2">
          Top contributors ranked by FoxPoints. Every approved milestone earns points and builds your tier.
        </p>
      </div>

      {/* Tier system overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {TIERS.map(({ name, min, max, color }) => (
          <div key={name} className={clsx("card text-center cursor-pointer transition-all",
            filterTier === name ? "border-violet-600" : "hover:border-gray-600")}
            onClick={() => setFilterTier(filterTier === name ? "all" : name as any)}>
            <div className="text-2xl mb-1">{TIER_ICONS[name]}</div>
            <div className="font-semibold text-sm">{name}</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {max ? `${min}–${max} pts` : `${min}+ pts`}
            </div>
            <div className={clsx("h-1 rounded-full mt-2", color)} />
          </div>
        ))}
      </div>

      {/* Search and filter */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or address..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-violet-500"
            aria-label="Search contributors"
          />
        </div>
        <button onClick={() => { setSearch(""); setFilterTier("all"); }}
          className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-400 hover:bg-gray-700 transition-colors">
          Reset
        </button>
      </div>

      {/* Leaderboard table */}
      <div className="space-y-2">
        {/* Header */}
        <div className="hidden md:grid grid-cols-12 gap-4 px-4 text-xs text-gray-500 mb-2">
          <span className="col-span-1">Rank</span>
          <span className="col-span-4">Contributor</span>
          <span className="col-span-2">Tier</span>
          <span className="col-span-2 text-right">FoxPoints</span>
          <span className="col-span-2 text-right">Completed</span>
          <span className="col-span-1 text-right">Rejected</span>
        </div>

        {filtered.map((entry) => (
          <div key={entry.rank} className={clsx("card grid grid-cols-12 gap-4 items-center",
            entry.rank <= 3 ? "border-yellow-900/50" : "")}>

            {/* Rank */}
            <div className={clsx("col-span-1 text-lg font-bold",
              RANK_COLORS[entry.rank - 1] ?? "text-gray-500")}>
              {entry.rank <= 3 ? ["🥇", "🥈", "🥉"][entry.rank - 1] : `#${entry.rank}`}
            </div>

            {/* Contributor */}
            <div className="col-span-4">
              <div className="font-semibold text-sm">{entry.displayName}</div>
              <div className="text-xs font-mono text-gray-500">{entry.address}</div>
            </div>

            {/* Tier badge */}
            <div className="col-span-2">
              <span className={clsx("inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold",
                TIER_STYLES[entry.tier])}>
                {TIER_ICONS[entry.tier]} {entry.tier}
              </span>
            </div>

            {/* FoxPoints with mini bar */}
            <div className="col-span-2 text-right">
              <div className="flex items-center justify-end gap-2">
                <Star className="w-3 h-3 text-yellow-400" aria-hidden="true" />
                <span className="font-bold text-yellow-400">{entry.foxPoints.toLocaleString()}</span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-1 mt-1">
                <div className="bg-yellow-500 h-1 rounded-full"
                  style={{ width: `${Math.min((entry.foxPoints / 2500) * 100, 100)}%` }} />
              </div>
            </div>

            {/* Completed */}
            <div className="col-span-2 text-right">
              <div className="flex items-center justify-end gap-1 text-green-400">
                <TrendingUp className="w-3 h-3" aria-hidden="true" />
                <span className="font-semibold">{entry.completed}</span>
              </div>
            </div>

            {/* Rejected */}
            <div className="col-span-1 text-right text-gray-500 text-sm">
              {entry.rejected}
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="card text-center text-gray-500 py-12">
            No contributors match your search.
          </div>
        )}
      </div>

      <p className="text-center text-xs text-gray-600">
        Rankings update after each milestone approval on Stellar.
        <a href="/reputation" className="text-violet-400 hover:underline ml-1">Look up any address →</a>
      </p>
    </div>
  );
}
