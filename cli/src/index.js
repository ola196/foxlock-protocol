#!/usr/bin/env node
/**
 * FoxLock CLI — Command-line tool for FoxLock Protocol escrow contracts
 *
 * Usage:
 *   foxlock escrow create      — Create a new escrow and lock funds
 *   foxlock escrow info        — View full escrow details
 *   foxlock escrow balance     — Check unreleased balance
 *   foxlock escrow count       — Total number of escrows on-chain
 *   foxlock milestone submit   — Submit proof of work (contributor)
 *   foxlock milestone approve  — Approve a milestone and release funds (client)
 *   foxlock milestone reject   — Reject a submitted milestone (client)
 *   foxlock milestone list     — List all milestones for an escrow
 *   foxlock reputation get     — Get contributor reputation profile
 *   foxlock network info       — Show network and contract addresses
 */

import { Command } from "commander";
import chalk from "chalk";
import { escrowCommands } from "./commands/escrow.js";
import { milestoneCommands } from "./commands/milestone.js";
import { reputationCommands } from "./commands/reputation.js";
import { networkCommands } from "./commands/network.js";

const program = new Command();

program
  .name("foxlock")
  .description(
    chalk.bold("🦊 FoxLock Protocol CLI") +
    "\nInteract with FoxLock escrow and reputation contracts on Stellar"
  )
  .version("0.1.0");

// Register command groups
escrowCommands(program);
milestoneCommands(program);
reputationCommands(program);
networkCommands(program);

program.addHelpText("after", `
${chalk.yellow("Examples:")}
  ${chalk.dim("# Create an escrow with two milestones (client = STELLAR_OPERATOR_SECRET)")}
  ${chalk.cyan(`$ foxlock escrow create \\
      --contributor GABC...XYZ \\
      --arbitrator  GDEF...UVW \\
      --token       CDLZ...TOKEN \\
      --deadline    5000000 \\
      --milestones  '[{"title":"Backend API","amount":500},{"title":"Frontend","amount":500}]'`)}

  ${chalk.dim("# Check balance of escrow #1")}
  ${chalk.cyan("$ foxlock escrow balance --id 1")}

  ${chalk.dim("# View full escrow details")}
  ${chalk.cyan("$ foxlock escrow info --id 1")}

  ${chalk.dim("# Submit proof for milestone 0 (contributor)")}
  ${chalk.cyan('$ foxlock milestone submit --escrow 1 --index 0 --proof "ipfs://bafyrei..."')}

  ${chalk.dim("# Approve milestone 0 and release funds (client)")}
  ${chalk.cyan("$ foxlock milestone approve --escrow 1 --index 0")}

  ${chalk.dim("# List all milestones for escrow #1")}
  ${chalk.cyan("$ foxlock milestone list --escrow 1")}

  ${chalk.dim("# Get contributor reputation")}
  ${chalk.cyan("$ foxlock reputation get --address G...")}

${chalk.yellow("Environment Variables:")}
  STELLAR_NETWORK            testnet | mainnet  ${chalk.gray("(default: testnet)")}
  STELLAR_RPC_URL            Soroban RPC endpoint
  STELLAR_OPERATOR_SECRET    Secret key for signing transactions (S...)
  ESCROW_CONTRACT_ID         Deployed escrow contract ID
  REPUTATION_CONTRACT_ID     Deployed reputation contract ID

${chalk.yellow("Deployed Contracts (Testnet):")}
  Escrow      CCQ7CUG4NZ6QSAG62OMCVYWXVPXJMBJF2WCA6WJRBZ3YOQ4K2DWN5RHV
  Reputation  CD2VIBP7TYVGW6NRFIM4WKUQDNUIIT2UB66CPF7K77DOO2WOMO4KB7U4

${chalk.yellow("Docs:")}
  https://github.com/vaultfox-protocol/foxlock-protocol
`);

program.parse();
