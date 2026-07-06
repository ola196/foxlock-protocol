/**
 * Global wallet state managed with Zustand.
 * Keeps wallet connection status in sync across all components.
 */

import { create } from "zustand";
import { connectWallet, getConnectedAddress } from "@/lib/wallet";

interface WalletState {
  address: string | null;
  isConnecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  checkConnection: () => Promise<void>;
}

export const useWalletStore = create<WalletState>((set) => ({
  address: null,
  isConnecting: false,
  error: null,

  connect: async () => {
    set({ isConnecting: true, error: null });
    try {
      const address = await connectWallet();
      set({ address, isConnecting: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to connect wallet",
        isConnecting: false,
      });
    }
  },

  disconnect: () => {
    set({ address: null, error: null });
  },

  checkConnection: async () => {
    const address = await getConnectedAddress();
    set({ address });
  },
}));
