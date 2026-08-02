import chalk from "chalk";
import ora from "ora";
import { invokeContract, toU64, toAddress, toString } from "../stellar.js";
import { ESCROW_CONTRACT_ID, OPERATOR_SECRET } from "../config.js";

function requireSecret() {
  if (!OPERATOR_SECRET) {
    console.error(chalk.red("❌ STELLAR_OPERATOR_SECRET not set in environment"));
    console.error(chalk.gray("Set it in your .env file: STELLAR_OPERATOR_SECRET=S..."));
    process.exit(1);
  }
  return OPERATOR_SECRET;
}

export function milestoneCommands(program) {
  const milestone = program.command("milestone").description("Milestone management commands");

  // ── milestone submit ─────────────────────────────────────────────────────
  milestone
    .command("submit")
    .description("Submit proof of completion for a milestone (contributor)")
    .requiredOption("--escrow <number>", "Escrow ID")
    .requiredOption("--index <number>", "Milestone index (0-based)")
    .requiredOption("--proof <url>", "IPFS CID or URL with proof of work")
    .action(async (opts) => {
      const secret = requireSecret();
      const spinner = ora(
        `Submitting milestone ${opts.index} for escrow #${opts.escrow}...`
      ).start();
      try {
        const { txHash } = await invokeContract(
          secret,
          ESCROW_CONTRACT_ID,
          "submit_milestone",
          [
            toAddress(new (await import("@stellar/stellar-sdk")).Keypair.fromSecret(secret).publicKey()),
            toU64(opts.escrow),
            new (await import("@stellar/stellar-sdk")).xdr.ScVal.scvU32(parseInt(opts.index)),
            toString(opts.proof),
          ]
        );
        spinner.succeed("Milestone submitted!");
        console.log(`${chalk.cyan("TX Hash:")} ${chalk.green(txHash)}`);
      } catch (err) {
        spinner.fail("Failed to submit milestone");
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });

  // ── milestone approve ────────────────────────────────────────────────────
  milestone
    .command("approve")
    .description("Approve a submitted milestone and release funds (client)")
    .requiredOption("--escrow <number>", "Escrow ID")
    .requiredOption("--index <number>", "Milestone index (0-based)")
    .action(async (opts) => {
      const secret = requireSecret();
      const { Keypair, xdr } = await import("@stellar/stellar-sdk");
      const spinner = ora(
        `Approving milestone ${opts.index} for escrow #${opts.escrow}...`
      ).start();
      try {
        const { txHash } = await invokeContract(
          secret,
          ESCROW_CONTRACT_ID,
          "approve_milestone",
          [
            toAddress(Keypair.fromSecret(secret).publicKey()),
            toU64(opts.escrow),
            xdr.ScVal.scvU32(parseInt(opts.index)),
          ]
        );
        spinner.succeed("Milestone approved! Funds released.");
        console.log(`${chalk.cyan("TX Hash:")} ${chalk.green(txHash)}`);
      } catch (err) {
        spinner.fail("Failed to approve milestone");
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });

  // ── milestone reject ─────────────────────────────────────────────────────
  milestone
    .command("reject")
    .description("Reject a submitted milestone (client)")
    .requiredOption("--escrow <number>", "Escrow ID")
    .requiredOption("--index <number>", "Milestone index (0-based)")
    .action(async (opts) => {
      const secret = requireSecret();
      const { Keypair, xdr } = await import("@stellar/stellar-sdk");
      const spinner = ora(
        `Rejecting milestone ${opts.index} for escrow #${opts.escrow}...`
      ).start();
      try {
        const { txHash } = await invokeContract(
          secret,
          ESCROW_CONTRACT_ID,
          "reject_milestone",
          [
            toAddress(Keypair.fromSecret(secret).publicKey()),
            toU64(opts.escrow),
            xdr.ScVal.scvU32(parseInt(opts.index)),
          ]
        );
        spinner.succeed("Milestone rejected. Contributor can resubmit.");
        console.log(`${chalk.cyan("TX Hash:")} ${chalk.green(txHash)}`);
      } catch (err) {
        spinner.fail("Failed to reject milestone");
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });
}
