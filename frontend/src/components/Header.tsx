"use client";

/**
 * Global header with wallet connect button.
 * Uses the walletStore so connection state is shared across the app.
 */
import Link from "next/link";
import { useEffect } from "react";
import { Wallet, LogOut } from "lucide-react";
import { useWalletStore } from "@/store/walletStore";

export function Header() {
  const { address, isConnecting, connect, disconnect, checkConnection } =
    useWalletStore();

  // Check if a wallet is already connected on mount
  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  const shortAddress = address
    ? `${address.slice(0, 4)}…${address.slice(-4)}`
    : null;

  return (
    <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-50">
      <div className="container mx-auto px-4 max-w-6xl flex items-center justify-between h-16">
        {/* Logo */}
        <Link
          href="/"
          className="font-bold text-lg flex items-center gap-2"
          aria-label="Home"
        >
          <span className="text-blue-400">◆</span>
          <span>MilestoneEscrow</span>
        </Link>

        {/* Nav */}
        <nav className="hidden md:flex items-center gap-6 text-sm text-gray-400">
          <Link href="/escrow" className="hover:text-white transition-colors">
            Escrows
          </Link>
          <Link
            href="/escrow/create"
            className="hover:text-white transition-colors"
          >
            Create
          </Link>
          <Link
            href="/dashboard"
            className="hover:text-white transition-colors"
          >
            Dashboard
          </Link>
          <Link
            href="/reputation"
            className="hover:text-white transition-colors"
          >
            Reputation
          </Link>
        </nav>

        {/* Wallet button */}
        {address ? (
          <div className="flex items-center gap-3">
            <span
              className="text-sm text-gray-300 font-mono bg-gray-800 px-3 py-1.5 rounded-lg"
              title={address}
            >
              {shortAddress}
            </span>
            <button
              onClick={disconnect}
              className="p-2 text-gray-500 hover:text-red-400 transition-colors rounded-lg hover:bg-gray-800"
              aria-label="Disconnect wallet"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={connect}
            disabled={isConnecting}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
            aria-label="Connect Stellar wallet"
          >
            <Wallet className="w-4 h-4" aria-hidden="true" />
            {isConnecting ? "Connecting…" : "Connect Wallet"}
          </button>
        )}
      </div>
    </header>
  );
}
