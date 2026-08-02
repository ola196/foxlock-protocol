import chalk from "chalk";
import ora from "ora";
import { queryContract, toU64, toAddress } from "../stellar.js";
import { ESCROW_CONTRACT_ID, NETWORK } from "../config.js";

export function escrowCommands(program) {
  const escrow = program.command("escrow").description("Escrow contract commands");

  // ── escrow info ─────────────────────────────────────────────────────────
  escrow
    .command("info")
    .description("View details of an escrow by ID")
    .requiredOption("--id <number>", "Escrow ID (on-chain)")
    .action(async (opts) => {
      const spinner = ora(`Fetching escrow #${opts.id}...`).start();
      try {
        const result = await queryContract(
          ESCROW_CONTRACT_ID,
          "get_escrow",
          [toU64(opts.id)]
        );

        spinner.stop();

        if (!result) {
          console.log(chalk.red(`Escrow #${opts.id} not found`));
          return;
        }

        const map = result.map();
        const data = {};
        if (map) {
          for (const entry of map) {
            const key = entry.key().sym()?.toString() ?? entry.key().str()?.toString();
            const val = entry.val();
            data[key] = scValToString(val);
          }
        }

        console.log("\n" + chalk.bold(`📦 Escrow #${opts.id}`));
        console.log(chalk.gray("─".repeat(50)));
        Object.entries(data).forEach(([k, v]) => {
          console.log(`${chalk.cyan(k.padEnd(20))} ${v}`);
        });
        console.log("");
        console.log(
          chalk.gray("View on Stellar Expert: ") +
          chalk.blue(`https://stellar.expert/explorer/${NETWORK}/contract/${ESCROW_CONTRACT_ID}`)
        );
      } catch (err) {
        spinner.fail("Failed to fetch escrow");
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });

  // ── escrow balance ──────────────────────────────────────────────────────
  escrow
    .command("balance")
    .description("Check unreleased balance of an escrow")
    .requiredOption("--id <number>", "Escrow ID")
    .action(async (opts) => {
      const spinner = ora(`Checking balance for escrow #${opts.id}...`).start();
      try {
        const result = await queryContract(
          ESCROW_CONTRACT_ID,
          "get_balance",
          [toU64(opts.id)]
        );
        spinner.stop();

        const balance = result?.i128
          ? `${(BigInt(result.i128().hi()) * BigInt(2 ** 64) + BigInt(result.i128().lo())) / BigInt(1e7)} tokens`
          : result?.toString() ?? "0";

        console.log("\n" + chalk.bold(`💰 Escrow #${opts.id} Balance`));
        console.log(chalk.gray("─".repeat(40)));
        console.log(`${chalk.cyan("Unreleased:")} ${chalk.yellow(balance)}`);
      } catch (err) {
        spinner.fail("Failed to fetch balance");
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });

  // ── escrow count ────────────────────────────────────────────────────────
  escrow
    .command("count")
    .description("Get total number of escrows created")
    .action(async () => {
      const spinner = ora("Fetching escrow count...").start();
      try {
        const result = await queryContract(ESCROW_CONTRACT_ID, "get_escrow_count", []);
        spinner.stop();
        const count = result?.u64()?.toString() ?? "0";
        console.log(`\n${chalk.cyan("Total Escrows:")} ${chalk.yellow(count)}`);
      } catch (err) {
        spinner.fail("Failed");
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });
}

function scValToString(val) {
  try {
    if (val.switch().name === "scvString") return val.str().toString();
    if (val.switch().name === "scvSymbol") return val.sym().toString();
    if (val.switch().name === "scvU64") return val.u64().toString();
    if (val.switch().name === "scvU32") return val.u32().toString();
    if (val.switch().name === "scvBool") return val.b().toString();
    if (val.switch().name === "scvAddress") return val.address().toString();
    if (val.switch().name === "scvVec") {
      const vec = val.vec();
      return vec ? `[${vec.map(scValToString).join(", ")}]` : "[]";
    }
    return val.switch().name;
  } catch {
    return "unknown";
  }
}
