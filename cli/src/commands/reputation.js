import chalk from "chalk";
import ora from "ora";
import { queryContract, toAddress } from "../stellar.js";
import { REPUTATION_CONTRACT_ID } from "../config.js";

const TIER_COLORS = {
  Cub:    chalk.gray,
  Fox:    chalk.yellow,
  Senior: chalk.magenta,
  Elite:  chalk.bold.yellow,
};

const TIER_ICONS = {
  Cub:    "🦊",
  Fox:    "🦊✨",
  Senior: "🦊⭐",
  Elite:  "🦊👑",
};

export function reputationCommands(program) {
  const reputation = program.command("reputation").description("Contributor reputation commands");

  // ── reputation get ───────────────────────────────────────────────────────
  reputation
    .command("get")
    .description("Get a contributor's FoxPoints, tier, and stats")
    .requiredOption("--address <G...>", "Contributor Stellar address")
    .action(async (opts) => {
      const spinner = ora(`Fetching reputation for ${opts.address.slice(0, 8)}...`).start();
      try {
        const result = await queryContract(
          REPUTATION_CONTRACT_ID,
          "get_profile",
          [toAddress(opts.address)]
        );
        spinner.stop();

        if (!result) {
          console.log(chalk.yellow("No profile found for this address."));
          return;
        }

        const map = result.map();
        const data = {};
        if (map) {
          for (const entry of map) {
            const key = entry.key().sym()?.toString() ?? "";
            const val = entry.val();
            if (val.switch().name === "scvU64") data[key] = val.u64().toString();
            else if (val.switch().name === "scvU32") data[key] = val.u32().toString();
            else if (val.switch().name === "scvVec") {
              const vec = val.vec();
              data[key] = vec?.[0]?.sym()?.toString() ?? "Unknown";
            }
          }
        }

        const tier = data["tier"] ?? "Cub";
        const colorFn = TIER_COLORS[tier] ?? chalk.white;
        const icon = TIER_ICONS[tier] ?? "🦊";

        console.log("\n" + chalk.bold(`${icon} Contributor Profile`));
        console.log(chalk.gray("─".repeat(50)));
        console.log(`${chalk.cyan("Address:")}           ${opts.address}`);
        console.log(`${chalk.cyan("Tier:")}              ${colorFn(tier)}`);
        console.log(`${chalk.cyan("FoxPoints:")}         ${chalk.yellow(data["fox_points"] ?? "0")}`);
        console.log(`${chalk.cyan("Completed:")}         ${data["milestones_completed"] ?? "0"} milestones`);
        console.log(`${chalk.cyan("Rejected:")}          ${data["milestones_rejected"] ?? "0"} milestones`);
        console.log(`${chalk.cyan("Last Updated:")}      Ledger ${data["last_updated"] ?? "—"}`);
        console.log("");

        // Show tier progression
        const points = parseInt(data["fox_points"] ?? "0");
        const TIERS = [
          { name: "Cub",    min: 0,    next: 100  },
          { name: "Fox",    min: 100,  next: 500  },
          { name: "Senior", min: 500,  next: 2000 },
          { name: "Elite",  min: 2000, next: null },
        ];
        const current = TIERS.find((t) => t.name === tier);
        if (current?.next) {
          const progress = Math.min(
            ((points - current.min) / (current.next - current.min)) * 100,
            100
          ).toFixed(0);
          const bar = "█".repeat(Math.floor(parseInt(progress) / 5)).padEnd(20, "░");
          console.log(`${chalk.cyan("Next tier:")}         ${bar} ${progress}% → ${TIERS[TIERS.indexOf(current) + 1]?.name}`);
        } else {
          console.log(chalk.bold.yellow("  🏆 Maximum tier reached!"));
        }
        console.log("");
      } catch (err) {
        spinner.fail("Failed to fetch reputation");
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });

  // ── reputation tier ──────────────────────────────────────────────────────
  reputation
    .command("tier")
    .description("Get just the tier for a contributor address")
    .requiredOption("--address <G...>", "Contributor Stellar address")
    .action(async (opts) => {
      const spinner = ora("Fetching tier...").start();
      try {
        const result = await queryContract(
          REPUTATION_CONTRACT_ID,
          "get_tier",
          [toAddress(opts.address)]
        );
        spinner.stop();
        const tier = result?.vec()?.[0]?.sym()?.toString() ?? "Cub";
        const icon = TIER_ICONS[tier] ?? "🦊";
        const colorFn = TIER_COLORS[tier] ?? chalk.white;
        console.log(`\n${icon}  ${colorFn(tier)}`);
      } catch (err) {
        spinner.fail("Failed");
        console.error(chalk.red(err.message));
        process.exit(1);
      }
    });
}
