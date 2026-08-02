import chalk from "chalk";
import ora from "ora";
import { server } from "../stellar.js";
import { NETWORK, RPC_URL, ESCROW_CONTRACT_ID, REPUTATION_CONTRACT_ID } from "../config.js";

export function networkCommands(program) {
  const network = program.command("network").description("Network and contract information");

  network
    .command("info")
    .description("Show current network settings and deployed contract IDs")
    .action(async () => {
      const spinner = ora("Fetching network info...").start();
      try {
        const ledger = await server.getLatestLedger();
        spinner.stop();

        console.log("\n" + chalk.bold("🌐 Network Info"));
        console.log(chalk.gray("─".repeat(50)));
        console.log(`${chalk.cyan("Network:")}         ${NETWORK}`);
        console.log(`${chalk.cyan("RPC URL:")}         ${RPC_URL}`);
        console.log(`${chalk.cyan("Latest Ledger:")}   ${chalk.yellow(ledger.sequence)}`);
        console.log("");
        console.log(chalk.bold("📋 Deployed Contracts"));
        console.log(chalk.gray("─".repeat(50)));
        console.log(`${chalk.cyan("Escrow:")}     ${chalk.green(ESCROW_CONTRACT_ID)}`);
        console.log(`${chalk.cyan("Reputation:")} ${chalk.green(REPUTATION_CONTRACT_ID)}`);
        console.log("");
        console.log(
          chalk.gray("View on Stellar Expert: ") +
          chalk.blue(`https://stellar.expert/explorer/${NETWORK}/contract/${ESCROW_CONTRACT_ID}`)
        );
      } catch (err) {
        spinner.fail("Failed to fetch network info");
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });
}
