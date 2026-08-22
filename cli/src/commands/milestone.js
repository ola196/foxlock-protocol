import chalk from "chalk";
import ora from "ora";
import { Keypair } from "@stellar/stellar-sdk";
import {
  invokeContract,
  queryContract,
  toAddress,
  toU64,
  toU32,
  toStr,
  scValToNative,
  formatAmount,
} from "../stellar.js";
import { ESCROW_CONTRACT_ID, NETWORK, OPERATOR_SECRET } from "../config.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function requireSecret() {
  if (!OPERATOR_SECRET) {
    console.error(chalk.red("❌  STELLAR_OPERATOR_SECRET is not set"));
    console.error(
      chalk.gray("Add it to your .env file:  STELLAR_OPERATOR_SECRET=S...")
    );
    process.exit(1);
  }
  return OPERATOR_SECRET;
}

/** Derive the caller's Stellar address from the secret in the environment. */
function callerAddress(secret) {
  return Keypair.fromSecret(secret).publicKey();
}

// ── Command registration ──────────────────────────────────────────────────────

export function milestoneCommands(program) {
  const milestone = program
    .command("milestone")
    .description("Milestone management commands");

  // ── milestone submit ──────────────────────────────────────────────────────
  milestone
    .command("submit")
    .description(
      "Submit proof of completion for a milestone  [contributor signs]"
    )
    .requiredOption("--escrow <number>", "Escrow ID")
    .requiredOption("--index <number>",  "Milestone index (0-based)")
    .requiredOption("--proof <url>",     "IPFS CID or URL pointing to proof of work")
    .action(async (opts) => {
      const secret = requireSecret();
      const contributor = callerAddress(secret);

      const spinner = ora(
        `Submitting milestone ${opts.index} for escrow #${opts.escrow}...`
      ).start();

      try {
        const { txHash } = await invokeContract(
          secret,
          ESCROW_CONTRACT_ID,
          "submit_milestone",
          [
            toAddress(contributor),     // contributor (must match escrow record)
            toU64(opts.escrow),         // escrow_id: u64
            toU32(opts.index),          // milestone_index: u32
            toStr(opts.proof),          // proof_url: String
          ]
        );

        spinner.succeed(chalk.green("Milestone submitted successfully!"));
        console.log("");
        console.log(`${chalk.cyan("Escrow ID:")}      ${opts.escrow}`);
        console.log(`${chalk.cyan("Milestone:")}      #${opts.index}`);
        console.log(`${chalk.cyan("Proof URL:")}      ${opts.proof}`);
        console.log(`${chalk.cyan("Contributor:")}    ${contributor}`);
        console.log(`${chalk.cyan("TX Hash:")}        ${chalk.green(txHash)}`);
        console.log(
          "\n" + chalk.gray("Track on Stellar Expert: ") +
          chalk.blue(
            `https://stellar.expert/explorer/${NETWORK}/tx/${txHash}`
          )
        );
        console.log("");
      } catch (err) {
        spinner.fail("Failed to submit milestone");
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });

  // ── milestone approve ─────────────────────────────────────────────────────
  milestone
    .command("approve")
    .description(
      "Approve a submitted milestone and release its funds  [client signs]"
    )
    .requiredOption("--escrow <number>", "Escrow ID")
    .requiredOption("--index <number>",  "Milestone index (0-based)")
    .action(async (opts) => {
      const secret = requireSecret();
      const client = callerAddress(secret);

      const spinner = ora(
        `Approving milestone ${opts.index} for escrow #${opts.escrow}...`
      ).start();

      try {
        const { txHash } = await invokeContract(
          secret,
          ESCROW_CONTRACT_ID,
          "approve_milestone",
          [
            toAddress(client),    // client (must match escrow record)
            toU64(opts.escrow),   // escrow_id: u64
            toU32(opts.index),    // milestone_index: u32
          ]
        );

        spinner.succeed(chalk.green("Milestone approved! Funds released to contributor."));
        console.log("");
        console.log(`${chalk.cyan("Escrow ID:")}  ${opts.escrow}`);
        console.log(`${chalk.cyan("Milestone:")}  #${opts.index}`);
        console.log(`${chalk.cyan("Approved by:")} ${client}`);
        console.log(`${chalk.cyan("TX Hash:")}    ${chalk.green(txHash)}`);
        console.log(
          "\n" + chalk.gray("Track on Stellar Expert: ") +
          chalk.blue(
            `https://stellar.expert/explorer/${NETWORK}/tx/${txHash}`
          )
        );
        console.log("");
      } catch (err) {
        spinner.fail("Failed to approve milestone");
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });

  // ── milestone reject ──────────────────────────────────────────────────────
  milestone
    .command("reject")
    .description(
      "Reject a submitted milestone — contributor may resubmit  [client signs]"
    )
    .requiredOption("--escrow <number>", "Escrow ID")
    .requiredOption("--index <number>",  "Milestone index (0-based)")
    .action(async (opts) => {
      const secret = requireSecret();
      const client = callerAddress(secret);

      const spinner = ora(
        `Rejecting milestone ${opts.index} for escrow #${opts.escrow}...`
      ).start();

      try {
        const { txHash } = await invokeContract(
          secret,
          ESCROW_CONTRACT_ID,
          "reject_milestone",
          [
            toAddress(client),    // client
            toU64(opts.escrow),   // escrow_id: u64
            toU32(opts.index),    // milestone_index: u32
          ]
        );

        spinner.succeed(
          chalk.yellow("Milestone rejected. Contributor can revise and resubmit.")
        );
        console.log("");
        console.log(`${chalk.cyan("Escrow ID:")}   ${opts.escrow}`);
        console.log(`${chalk.cyan("Milestone:")}   #${opts.index}`);
        console.log(`${chalk.cyan("Rejected by:")} ${client}`);
        console.log(`${chalk.cyan("TX Hash:")}     ${chalk.green(txHash)}`);
        console.log(
          "\n" + chalk.gray("Track on Stellar Expert: ") +
          chalk.blue(
            `https://stellar.expert/explorer/${NETWORK}/tx/${txHash}`
          )
        );
        console.log("");
      } catch (err) {
        spinner.fail("Failed to reject milestone");
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });

  // ── milestone list ────────────────────────────────────────────────────────
  milestone
    .command("list")
    .description("List all milestones for an escrow with their current status")
    .requiredOption("--escrow <number>", "Escrow ID")
    .action(async (opts) => {
      const spinner = ora(`Fetching milestones for escrow #${opts.escrow}...`).start();
      try {
        const retval = await queryContract(
          ESCROW_CONTRACT_ID,
          "get_escrow",
          [toU64(opts.escrow)]
        );

        spinner.stop();

        if (!retval) {
          console.log(chalk.red(`Escrow #${opts.escrow} not found.`));
          return;
        }

        const data = scValToNative(retval);
        const milestones = data.milestones ?? [];

        console.log("\n" + chalk.bold(`🏁  Milestones — Escrow #${opts.escrow}`));
        console.log(chalk.gray("─".repeat(52)));

        if (milestones.length === 0) {
          console.log(chalk.gray("  No milestones found."));
        } else {
          milestones.forEach((m, i) => {
            const status = String(m.status ?? "");
            const statusLabel =
              status.includes("Approved")
                ? chalk.green(status)
                : status.includes("Submitted")
                ? chalk.blue(status)
                : status.includes("Rejected")
                ? chalk.red(status)
                : chalk.gray(status);

            console.log(
              `  ${chalk.bold(`[${i}]`)}  ${chalk.white(String(m.title ?? ""))}` +
              `  ${formatAmount(BigInt(m.amount ?? 0n))} tokens  ${statusLabel}`
            );
            if (m.proof_url && String(m.proof_url) !== "") {
              console.log(`        ${chalk.gray("proof: " + m.proof_url)}`);
            }
          });
        }
        console.log("");
      } catch (err) {
        spinner.fail("Failed to list milestones");
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });
}
