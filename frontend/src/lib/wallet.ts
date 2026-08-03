/**
 * Wallet abstraction layer using Stellar Wallets Kit v2.
 *
 * Stellar Wallets Kit provides a unified interface across Freighter,
 * xBull, Albedo, LOBSTR, and other Stellar wallets. This file wraps
 * it into a clean API consumed by the rest of the app.
 */

import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import { Networks } from "@stellar/stellar-sdk";

const NETWORK_PASSPHRASE: string =
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ??
  (process.env.NEXT_PUBLIC_NETWORK === "mainnet"
    ? Networks.PUBLIC
    : Networks.TESTNET);

// Initialize the kit singleton once.
// StellarWalletsKit.init is idempotent — safe to call multiple times.
function ensureInit() {
  StellarWalletsKit.init({ modules: defaultModules() });
}

/**
 * Open the wallet selection button/modal and return the connected public key.
 * The v2 kit manages the UI via a web-component — call createButton to mount it.
 */
export async function connectWallet(): Promise<string> {
  ensureInit();

  // Mount the connect button if not yet in DOM (no-op if already present).
  const wrapper = document.querySelector<HTMLElement>("#swk-button-wrapper");
  if (wrapper) {
    StellarWalletsKit.createButton(wrapper);
  }

  const { address } = await StellarWalletsKit.getAddress();
  if (!address) throw new Error("No wallet address returned");
  return address;
}

/**
 * Get the currently connected wallet address (if any).
 */
export async function getConnectedAddress(): Promise<string | null> {
  try {
    ensureInit();
    const { address } = await StellarWalletsKit.getAddress();
    return address || null;
  } catch {
    return null;
  }
}

/**
 * Sign a Soroban XDR transaction string and return the signed XDR.
 */
export async function signTransaction(
  xdr: string,
  opts?: { networkPassphrase?: string; address?: string }
): Promise<string> {
  ensureInit();
  const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
    networkPassphrase: opts?.networkPassphrase ?? NETWORK_PASSPHRASE,
    address: opts?.address,
  });
  return signedTxXdr;
}
