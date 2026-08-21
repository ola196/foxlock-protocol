/**
 * Home page — overview of the protocol and entry points.
 */
import Link from "next/link";
import { Shield, GitMerge, Star, Zap } from "lucide-react";

const features = [
  {
    icon: Shield,
    title: "Trustless Escrow",
    description:
      "Funds are locked in a Soroban smart contract until milestones are approved. No middleman, no surprises.",
  },
  {
    icon: GitMerge,
    title: "Milestone-based Release",
    description:
      "Break work into milestones. Funds release incrementally as each one is reviewed and approved.",
  },
  {
    icon: Star,
    title: "On-chain Reputation",
    description:
      "Every approved milestone earns FoxPoints and builds your contributor tier — permanently on Stellar.",
  },
  {
    icon: Zap,
    title: "Dispute Resolution",
    description:
      "Either party can raise a dispute. A trusted arbitrator splits the remaining funds fairly.",
  },
];

export default function HomePage() {
  return (
    <div className="space-y-16">
      {/* Hero */}
      <section className="text-center space-y-6 pt-12">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-900/30 border border-blue-700 rounded-full text-blue-300 text-sm">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          Live on Stellar Testnet
        </div>
        <h1 className="text-5xl font-bold tracking-tight">
          Milestone Escrow
          <span className="text-blue-400"> on Stellar</span>
        </h1>
        <p className="text-xl text-gray-400 max-w-2xl mx-auto">
          Trustless, transparent contributor payments. Built for{" "}
          <span className="text-white">GrantFox</span> — powering Web3
          collaboration with Soroban smart contracts.
        </p>
        <div className="flex flex-wrap gap-4 justify-center">
          <Link
            href="/escrow/create"
            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors"
            aria-label="Create a new escrow agreement"
          >
            Create Escrow
          </Link>
          <Link
            href="/dashboard"
            className="px-6 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors"
            aria-label="View your personal escrow dashboard"
          >
            My Dashboard
          </Link>
          <Link
            href="/escrow"
            className="px-6 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors"
            aria-label="Browse existing escrows"
          >
            Browse Escrows
          </Link>
        </div>
      </section>

      {/* Features */}
      <section>
        <h2 className="text-2xl font-semibold text-center mb-8">How it works</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {features.map(({ icon: Icon, title, description }) => (
            <div key={title} className="card flex gap-4">
              <div className="w-10 h-10 rounded-lg bg-blue-900/40 flex items-center justify-center shrink-0">
                <Icon className="w-5 h-5 text-blue-400" aria-hidden="true" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">{title}</h3>
                <p className="text-gray-400 text-sm">{description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Stats strip */}
      <section className="card">
        <div className="grid grid-cols-3 divide-x divide-gray-800 text-center">
          {[
            { label: "Contracts deployed", value: "Soroban" },
            { label: "Network", value: "Stellar Testnet" },
            { label: "Token support", value: "Any SEP-0041" },
          ].map(({ label, value }) => (
            <div key={label} className="px-6 py-2">
              <div className="text-lg font-bold text-blue-400">{value}</div>
              <div className="text-sm text-gray-500">{label}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
