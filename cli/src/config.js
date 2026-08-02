import { config } from "dotenv";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

// Load .env from CLI directory or project root
config({ path: join(process.cwd(), ".env") });

export const NETWORK = process.env.STELLAR_NETWORK ?? "testnet";
export const RPC_URL = process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
export const NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";

export const ESCROW_CONTRACT_ID =
  process.env.ESCROW_CONTRACT_ID ?? "CCQ7CUG4NZ6QSAG62OMCVYWXVPXJMBJF2WCA6WJRBZ3YOQ4K2DWN5RHV";
export const REPUTATION_CONTRACT_ID =
  process.env.REPUTATION_CONTRACT_ID ?? "CD2VIBP7TYVGW6NRFIM4WKUQDNUIIT2UB66CPF7K77DOO2WOMO4KB7U4";

export const OPERATOR_SECRET = process.env.STELLAR_OPERATOR_SECRET;
