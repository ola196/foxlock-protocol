import chalk from "chalk";
import ora from "ora";
import {
  invokeContract,
  queryContract,
  toAddress,
  toU64,
  toU32,
  toI128,
  toStr,
  scValToNative,
  i128ToBigInt,
  formatAmount,
} from "../stellar.js";
import { ESCROW_CONTRACT_ID, NETWORK, OPERATOR_SECRET } from "../config.js";
import { nativeToScVal, xdr } from "@stellar/stellar-sdk";

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

/**
 * Build a Soroban Vec<Milestone> ScVal from a JSON-encoded milestone array.
 *
 * Each milestone object must have:
 *   { title: string, amount: number | string }
 *
 * Milestone status is always forced to "Pending" (MilestoneStatus::Pending)
 * and proof_url to "" on creation, matching the contract invariant.
 */
function buildMilestonesVec(milestonesJson) {
  let milestones;
  try {
    milestones = JSON.parse(milestonesJson);
  } catch {
    throw new Error(
      `--milestones must be valid JSON, e.g.: '[{"title":"MVP","amount":500}]'`
    );
  }

  if (!Array.isArray(milestones) || milestones.length === 0) {
    throw new Error("Provide at least one milestone.");
  }
  if (milestones.length > 20) {
    throw new Error("Maximum 20 milestones per escrow.");
  }

  // Build each Milestone as an ScVal Map matching the Soroban struct field order:
  // { title, amount, status, proof_url }
  const scMilestones = milestones.map((m, i) => {
    if (!m.title || typeof m.title !== "string") {
      throw new Error(`Milestone[${i}] missing "title" string.`);
    }
    const amountUnits = BigInt(Math.round(Number(m.amount) * 1e7));
    if (amountUnits <= 0n) {
      throw new Error(`Milestone[${i}] amount must be > 0.`);
    }

    return xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("title"),
        val: toStr(m.title),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("amount"),
        val: toI128(amountUnits),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("status"),
        // MilestoneStatus::Pending — encoded as an enum variant (ScvVec of one symbol)
        val: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Pending")]),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("proof_url"),
        val: toStr(""),
      }),
    ]);
  });

  return xdr.ScVal.scvVec(scMilestones);
}

// ── Command registration ──────────────────────────────────────────────────────

export function escrowCommands(program) {
  const escrow = program.command("escrow").description("Escrow contract commands");

  // ── escrow create ─────────────────────────────────────────────────────────
  escrow
    .command("create")
    .description("Create a new escrow agreement and lock funds on-chain")
    .requiredOption("--contributor <address>", "Stellar address of the contributor (G...)")
    .requiredOption("--arbitrator <address>", "Stellar address of the arbitrator (G...)")
    .requiredOption("--token <address>",       "SEP-0041 token contract address (C...)")
    .requiredOption(
      "--milestones <json>",
      'JSON array of milestones, e.g. \'[{"title":"Phase 1","amount":100}]\''
    )
    .requiredOption(
      "--deadline <ledger>",
      "Ledger number after which the contributor can claim without approval"
    )
    .option("--description <text>", "Human-readable description of the escrow", "")
    .action(async (opts) => {
      const secret = requireSecret();

      // Build milestones ScVal before spinning — gives early parse errors
      let milestonesVal;
      try {
        milestonesVal = buildMilestonesVec(opts.milestones);
      } catch (err) {
        console.error(chalk.red(`❌  ${err.message}`));
        process.exit(1);
      }

      const spinner = ora("Creating escrow on Stellar Testnet...").start();

      try {
        const { Keypair } = await import("@stellar/stellar-sdk");
        const clientAddress = Keypair.fromSecret(secret).publicKey();

        const { txHash, result } = await invokeContract(
          secret,
          ESCROW_CONTRACT_ID,
          "create_escrow",
          [
            toAddress(clientAddress),        // client  (signer)
            toAddress(opts.contributor),      // contributor
            toAddress(opts.arbitrator),       // arbitrator
            toAddress(opts.token),            // token contract
            milestonesVal,                    // Vec<Milestone>
            toU32(opts.deadline),             // deadline_ledger
            toStr(opts.description),          // description
          ]
        );

        // The contract returns the new escrow ID as u64
        const escrowId =
          result.returnValue
            ? scValToNative(result.returnValue).toString()
            : "unknown";

        spinner.succeed(chalk.green("Escrow created!"));
        console.log("");
        console.log(`${chalk.cyan("Escrow ID:")}   ${chalk.yellow(escrowId)}`);
        console.log(`${chalk.cyan("Client:")}      ${clientAddress}`);
        console.log(`${chalk.cyan("Contributor:")} ${opts.contributor}`);
        console.log(`${chalk.cyan("Arbitrator:")}  ${opts.arbitrator}`);
        console.log(`${chalk.cyan("Token:")}       ${opts.token}`);
        console.log(`${chalk.cyan("Deadline:")}    ledger ${opts.deadline}`);
        console.log(`${chalk.cyan("TX Hash:")}     ${chalk.green(txHash)}`);
        console.log(
          "\n" + chalk.gray("Track on Stellar Expert: ") +
          chalk.blue(
            `https://stellar.expert/explorer/${NETWORK}/tx/${txHash}`
          )
        );
      } catch (err) {
        spinner.fail("Failed to create escrow");
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });

  // ── escrow info ───────────────────────────────────────────────────────────
  escrow
    .command("info")
    .description("View details of an escrow by ID")
    .requiredOption("--id <number>", "Escrow ID")
    .action(async (opts) => {
      const spinner = ora(`Fetching escrow #${opts.id}...`).start();
      try {
        const retval = await queryContract(ESCROW_CONTRACT_ID, "get_escrow", [
          toU64(opts.id),
        ]);

        spinner.stop();

        if (!retval) {
          console.log(chalk.red(`Escrow #${opts.id} not found.`));
          return;
        }

        const data = scValToNative(retval);

        console.log("\n" + chalk.bold(`📦  Escrow #${opts.id}`));
        console.log(chalk.gray("─".repeat(52)));

        const row = (label, value) =>
          console.log(`${chalk.cyan(label.padEnd(22))} ${value}`);

        row("Client:",       String(data.client ?? ""));
        row("Contributor:",  String(data.contributor ?? ""));
        row("Arbitrator:",   String(data.arbitrator ?? ""));
        row("Token:",        String(data.token ?? ""));
        row("Status:",       chalk.yellow(String(data.status ?? "")));
        row("Total amount:", formatAmount(BigInt(data.total_amount ?? 0n)) + " tokens");
        row("Released:",     formatAmount(BigInt(data.released_amount ?? 0n)) + " tokens");
        row("Deadline:",     `ledger ${data.deadline_ledger ?? "?"}`);
        row("Description:",  String(data.description ?? ""));

        // Milestones
        const milestones = data.milestones ?? [];
        if (milestones.length > 0) {
          console.log("\n" + chalk.bold("Milestones:"));
          milestones.forEach((m, i) => {
            const statusColor =
              String(m.status).includes("Approved")
                ? chalk.green
                : String(m.status).includes("Submitted")
                ? chalk.blue
                : String(m.status).includes("Rejected")
                ? chalk.red
                : chalk.gray;
            console.log(
              `  [${i}] ${chalk.white(String(m.title ?? ""))}  ` +
              `${formatAmount(BigInt(m.amount ?? 0n))} tokens  ` +
              statusColor(String(m.status))
            );
            if (m.proof_url && String(m.proof_url) !== "") {
              console.log(`       ${chalk.gray("proof: " + m.proof_url)}`);
            }
          });
        }

        console.log(
          "\n" + chalk.gray("View on Stellar Expert: ") +
          chalk.blue(
            `https://stellar.expert/explorer/${NETWORK}/contract/${ESCROW_CONTRACT_ID}`
          )
        );
        console.log("");
      } catch (err) {
        spinner.fail("Failed to fetch escrow");
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });

  // ── escrow balance ────────────────────────────────────────────────────────
  escrow
    .command("balance")
    .description("Check the unreleased balance of an escrow")
    .requiredOption("--id <number>", "Escrow ID")
    .action(async (opts) => {
      const spinner = ora(`Checking balance for escrow #${opts.id}...`).start();
      try {
        const retval = await queryContract(ESCROW_CONTRACT_ID, "get_balance", [
          toU64(opts.id),
        ]);

        spinner.stop();

        // get_balance returns Result<i128, EscrowError>; the retval is the
        // Ok-variant i128 after the contract result is unwrapped by the RPC sim.
        let balance = "0.0000000 tokens";
        if (retval && retval.switch().name === "scvI128") {
          const raw = i128ToBigInt(retval);
          balance = formatAmount(raw < 0n ? 0n : raw) + " tokens";
        }

        console.log("\n" + chalk.bold(`💰  Escrow #${opts.id} Balance`));
        console.log(chalk.gray("─".repeat(40)));
        console.log(`${chalk.cyan("Unreleased:")} ${chalk.yellow(balance)}`);
        console.log("");
      } catch (err) {
        spinner.fail("Failed to fetch balance");
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });

  // ── escrow count ──────────────────────────────────────────────────────────
  escrow
    .command("count")
    .description("Get the total number of escrows created")
    .action(async () => {
      const spinner = ora("Fetching escrow count...").start();
      try {
        const retval = await queryContract(
          ESCROW_CONTRACT_ID,
          "get_escrow_count",
          []
        );
        spinner.stop();
        const count =
          retval?.switch().name === "scvU64"
            ? retval.u64().toString()
            : "0";
        console.log(
          `\n${chalk.cyan("Total Escrows:")} ${chalk.yellow(count)}\n`
        );
      } catch (err) {
        spinner.fail("Failed to fetch count");
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });
}
