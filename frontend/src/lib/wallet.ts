/**
 * Wallet abstraction layer using Stellar Wallets Kit.
 *
 * Stellar Wallets Kit provides a unified interface across Freighter,
 * xBull, Albedo, LOBSTR, and other Stellar wallets. This file wraps
 * it into a clean API consumed by the rest of the app.
 */

import {
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
  FREIGHTER_ID,
} from "stellar-wallets-kit";

const NETWORK = (process.env.NEXT_PUBLIC_NETWORK === "mainnet"
  ? WalletNetwork.PUBLIC
  : WalletNetwork.TESTNET) as WalletNetwork;

// Singleton wallet kit instance
let kit: StellarWalletsKit | null = null;

export function getWalletKit(): StellarWalletsKit {
  if (!kit) {
    kit = new StellarWalletsKit({
      network: NETWORK,
      selectedWalletId: FREIGHTER_ID,
      modules: allowAllModules(),
    });
  }
  return kit;
}

/**
 * Open the wallet selection modal and return the connected public key.
 */
export async function connectWallet(): Promise<string> {
  const walletKit = getWalletKit();
  await walletKit.openModal({
    onWalletSelected: async (option) => {
      walletKit.setWallet(option.id);
    },
  });
  const { address } = await walletKit.getAddress();
  return address;
}

/**
 * Get the currently connected wallet address (if any).
 */
export async function getConnectedAddress(): Promise<string | null> {
  try {
    const walletKit = getWalletKit();
    const { address } = await walletKit.getAddress();
    return address || null;
  } catch {
    return null;
  }
}

/**
 * Sign and submit a Soroban XDR transaction.
 * Returns the signed XDR string ready for submission to the RPC.
 */
export async function signTransaction(
  xdr: string,
  opts?: { networkPassphrase?: string; address?: string }
): Promise<string> {
  const walletKit = getWalletKit();
  const { signedTxXdr } = await walletKit.signTransaction(xdr, {
    networkPassphrase:
      opts?.networkPassphrase ??
      process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ??
      "Test SDF Network ; September 2015",
    address: opts?.address,
  });
  return signedTxXdr;
}
