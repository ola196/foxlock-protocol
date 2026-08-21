#!/usr/bin/env node
/**
 * FoxLock CLI — Command-line tool for FoxLock Protocol escrow contracts
 *
 * Usage:
 *   foxlock escrow create   — Create a new escrow agreement
 *   foxlock escrow info     — View escrow details
 *   foxlock escrow balance  — Check unreleased balance
 *   foxlock milestone submit — Submit milestone proof
 *   foxlock milestone approve — Approve a milestone
 *   foxlock milestone reject  — Reject a milestone
 *   foxlock dispute raise   — Raise a dispute
 *   foxlock reputation get  — Get contributor reputation
 *   foxlock network info    — Show network and contract info
 */

import { Command } from "commander";
import chalk from "chalk";
import { escrowCommands } from "./commands/escrow.js";
import { milestoneCommands } from "./commands/milestone.js";
import { reputationCommands } from "./commands/reputation.js";
import { networkCommands } from "./commands/network.js";
import { stellarWrapCommands } from "./commands/stellar-wrap.js";

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
stellarWrapCommands(program);

// Show help if no command provided
program.addHelpText("after", `
${chalk.yellow("Examples:")}
  ${chalk.cyan("$ foxlock network info")}
  ${chalk.cyan("$ foxlock escrow info --id 1")}
  ${chalk.cyan("$ foxlock reputation get --address G...")}
  ${chalk.cyan("$ foxlock escrow balance --id 1")}

${chalk.bold("stellar-cli wrapper (requires: cargo install --locked stellar-cli):")}
  ${chalk.cyan("$ foxlock stellar create-escrow --contributor G... --arbitrator G... --token C... --deadline 12345 --description 'My project' --milestones '[{\"title\":\"Design\",\"amount\":\"5000000\"}]' --source my-key")}
  ${chalk.cyan("$ foxlock stellar submit-milestone --escrow 1 --index 0 --proof ipfs://Qm... --source my-key")}
  ${chalk.cyan("$ foxlock stellar approve-milestone --escrow 1 --index 0 --source my-key")}
  ${chalk.cyan("$ foxlock stellar check-balance --escrow 1")}

${chalk.yellow("Environment Variables:")}
  STELLAR_NETWORK           testnet | mainnet (default: testnet)
  STELLAR_RPC_URL           Soroban RPC endpoint
  STELLAR_OPERATOR_SECRET   Secret key for signing transactions (S...) — SDK commands
  STELLAR_SOURCE_KEY        Named key or secret for stellar-cli wrapper commands
  ESCROW_CONTRACT_ID        Deployed escrow contract ID
  REPUTATION_CONTRACT_ID    Deployed reputation contract ID

${chalk.yellow("Docs:")}
  https://github.com/stellarfox-labs/foxlock-protocol
`);

program.parse();
