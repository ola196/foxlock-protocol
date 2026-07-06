"use client";

/**
 * Reputation lookup page.
 * Look up any contributor's FoxPoints, tier, and contribution history.
 */

import { useState } from "react";
import { Search, Star, Trophy, TrendingUp, Loader2 } from "lucide-react";
import {
  queryContract,
  REPUTATION_CONTRACT_ID,
  toAddress,
} from "@/lib/stellar";
import { xdr } from "@stellar/stellar-sdk";
import clsx from "clsx";

interface Profile {
  fox_points: string;
  milestones_completed: string;
  milestones_rejected: string;
  tier: string;
  last_updated: string;
}

const TIER_STYLES: Record<string, string> = {
  Cub: "text-gray-400 bg-gray-800 border-gray-700",
  Fox: "text-orange-300 bg-orange-900/30 border-orange-700",
  Senior: "text-purple-300 bg-purple-900/30 border-purple-700",
  Elite: "text-yellow-300 bg-yellow-900/30 border-yellow-700",
};

const TIER_ICONS: Record<string, string> = {
  Cub: "🦊",
  Fox: "🦊✨",
  Senior: "🦊⭐",
  Elite: "🦊👑",
};

export default function ReputationPage() {
  const [lookupAddress, setLookupAddress] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lookupAddress.startsWith("G")) return;

    setIsLoading(true);
    setError(null);
    setProfile(null);

    try {
      const result = await queryContract(
        REPUTATION_CONTRACT_ID,
        "get_profile",
        [toAddress(lookupAddress)],
        (val: xdr.ScVal) => {
          // Parse the returned struct ScVal into a plain object
          const map = val.map();
          if (!map) throw new Error("Unexpected return type");
          const obj: Record<string, string> = {};
          for (const entry of map) {
            const key = entry.key().sym().toString();
            const value = entry.val();
            obj[key] = value.u64()?.toString() ?? value.vec()?.[0]?.sym()?.toString() ?? "?";
          }
          return obj as unknown as Profile;
        }
      );
      setProfile(result);
    } catch (err) {
      setError(
        err instanceof Error && err.message.includes("NotFound")
          ? "No profile found for this address."
          : err instanceof Error
          ? err.message
          : "Failed to load profile"
      );
    } finally {
      setIsLoading(false);
    }
  };

  const tierName = profile?.tier ?? "Cub";

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Contributor Reputation</h1>
        <p className="text-gray-400 mt-2">
          Look up any contributor&apos;s FoxPoints, tier, and on-chain
          contribution history.
        </p>
      </div>

      {/* Tier info */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-300 mb-4">
          Tier System
        </h2>
        <div className="grid grid-cols-4 gap-3">
          {[
            { tier: "Cub", min: 0, cap: "3 issues" },
            { tier: "Fox", min: 100, cap: "5 issues" },
            { tier: "Senior", min: 500, cap: "10 issues" },
            { tier: "Elite", min: 2000, cap: "Unlimited" },
          ].map(({ tier, min, cap }) => (
            <div
              key={tier}
              className={clsx(
                "p-3 rounded-lg border text-center text-xs",
                TIER_STYLES[tier]
              )}
            >
              <div className="text-lg mb-1">{TIER_ICONS[tier]}</div>
              <div className="font-semibold">{tier}</div>
              <div className="opacity-70">{min}+ pts</div>
              <div className="opacity-70">{cap}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Lookup form */}
      <form onSubmit={handleLookup} className="card">
        <label
          htmlFor="address-input"
          className="block text-sm text-gray-400 mb-2"
        >
          Stellar Address
        </label>
        <div className="flex gap-3">
          <input
            id="address-input"
            type="text"
            value={lookupAddress}
            onChange={(e) => setLookupAddress(e.target.value)}
            placeholder="G..."
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-blue-500"
            aria-label="Stellar address to look up"
          />
          <button
            type="submit"
            disabled={isLoading || !lookupAddress}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm flex items-center gap-2 transition-colors"
            aria-label="Look up contributor profile"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            Look up
          </button>
        </div>
      </form>

      {error && (
        <div
          role="alert"
          className="p-4 bg-gray-900 border border-gray-700 rounded-lg text-gray-400 text-sm"
        >
          {error}
        </div>
      )}

      {/* Profile result */}
      {profile && (
        <div className="card space-y-6" aria-live="polite">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-lg">Contributor Profile</h2>
              <p className="text-xs text-gray-500 font-mono mt-1">
                {lookupAddress}
              </p>
            </div>
            <div
              className={clsx(
                "px-4 py-2 rounded-full border text-sm font-semibold",
                TIER_STYLES[tierName]
              )}
            >
              {TIER_ICONS[tierName]} {tierName}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="bg-gray-800 rounded-lg p-4 text-center">
              <Star
                className="w-5 h-5 text-yellow-400 mx-auto mb-2"
                aria-hidden="true"
              />
              <div className="text-2xl font-bold text-yellow-400">
                {profile.fox_points}
              </div>
              <div className="text-xs text-gray-500 mt-1">FoxPoints</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4 text-center">
              <Trophy
                className="w-5 h-5 text-green-400 mx-auto mb-2"
                aria-hidden="true"
              />
              <div className="text-2xl font-bold text-green-400">
                {profile.milestones_completed}
              </div>
              <div className="text-xs text-gray-500 mt-1">Completed</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4 text-center">
              <TrendingUp
                className="w-5 h-5 text-blue-400 mx-auto mb-2"
                aria-hidden="true"
              />
              <div className="text-2xl font-bold text-blue-400">
                {profile.milestones_rejected}
              </div>
              <div className="text-xs text-gray-500 mt-1">Rejected</div>
            </div>
          </div>

          <p className="text-xs text-gray-600 text-center">
            Profile stored on Stellar — immutable and verifiable.
          </p>
        </div>
      )}
    </div>
  );
}
