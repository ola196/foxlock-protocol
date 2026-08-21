/**
 * stellar-wrap.js — stellar-cli binary wrapper commands
 *
 * Issue #46: Adds a `foxlock stellar` subcommand group that shells out to the
 * `stellar` CLI binary (cargo install --locked stellar-cli) instead of
 * constructing and signing transactions with the JavaScript SDK.
 *
 * Advantages over the SDK-based commands:
 *   - No XDR construction in JavaScript — stellar-cli handles all encoding
 *   - Uses stellar-cli's key management (named keys, hardware wallets)
 *   - Easier for power users who already have stellar-cli installed
 *   - Output is identical to running stellar contract invoke directly
 *
 * Prerequisites:
 *   stellar-cli installed: cargo install --locked stellar-cli
 *   A funded key configured: stellar keys generate my-key --network testnet
 *
 * Environment variables honoured (same as the rest of the CLI):
 *   STELLAR_NETWORK         testnet | mainnet (default: testnet)
 *   STELLAR_RPC_URL         Soroban RPC endpoint
 *   STELLAR_SOURCE_KEY      Named key OR secret (S...) for signing
 *                           (e.g. "my-key" or "SXXXXX…")
 *   ESCROW_CONTRACT_ID      Deployed escrow contract address
 *
 * Closes #46
 */

import { spawnSync } from "child_process";
import chalk from "chalk";
import ora from "ora";
import { ESCROW_CONTRACT_ID, NETWORK, RPC_URL } from "../config.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve the stellar-cli binary path.
 * Tries the PATH first, then common Cargo install locations.
 */
function findStellarBin() {
  // Quick check: is `stellar` on PATH?
  const which = spawnSync("which", ["stellar"], { encoding: "utf-8" });
  if (which.status === 0 && which.stdout.trim()) {
    return "stellar";
  }
  // Fallback to Cargo home
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const candidates = [
    `${home}/.cargo/bin/stellar`,
    "/usr/local/bin/stellar",
    "/usr/bin/stellar",
  ];
  for (const c of candidates) {
    const test = spawnSync("test", ["-f", c]);
    if (test.status === 0) return c;
  }
  return null;
}

/**
 * Assert stellar-cli is available, printing a helpful install message if not.
 */
function requireStellarCli() {
  const bin = findStellarBin();
  if (!bin) {
    console.error(chalk.red("❌  stellar-cli not found"));
    console.error(
      chalk.gray(
        "Install it with:  cargo install --locked stellar-cli\n" +
        "Then add ~/.cargo/bin to your PATH."
      )
    );
    process.exit(1);
  }
  return bin;
}

/**
 * Resolve the source key for signing.
 *
 * Priority:
 *   1. --source flag passed to the command
 *   2. STELLAR_SOURCE_KEY env var
 *   3. Fatal error — user must provide one
 */
function resolveSourceKey(flagValue) {
  const key = flagValue ?? process.env.STELLAR_SOURCE_KEY;
  if (!key) {
    console.error(chalk.red("❌  No signing key specified"));
    console.error(
      chalk.gray(
        "Pass --source <key-name-or-secret> or set STELLAR_SOURCE_KEY in your .env"
      )
    );
    process.exit(1);
  }
  return key;
}

/**
 * Build the common flags passed to every `stellar contract invoke` call.
 *
 * --network / --rpc-url are mutually exclusive in stellar-cli; we prefer
 * the named network alias when the user hasn't overridden the RPC URL.
 */
function commonFlags(network, rpcUrl) {
  const flags = ["--network", network];
  // If the user has set a custom RPC URL, forward it
  const defaultTestnet = "https://soroban-testnet.stellar.org";
  if (rpcUrl && rpcUrl !== defaultTestnet) {
    flags.push("--rpc-url", rpcUrl);
  }
  return flags;
}

/**
 * Run `stellar contract invoke …` and return { stdout, stderr, status }.
 *
 * We use spawnSync so the spinner stays alive and output is captured cleanly.
 * For interactive confirmations stellar-cli may need a TTY — we inherit stdio
 * when the user explicitly requests it via --interactive.
 */
function runStellarInvoke(bin, args, { interactive = false } = {}) {
  return spawnSync(bin, ["contract", "invoke", ...args], {
    encoding: "utf-8",
    stdio: interactive ? "inherit" : ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });
}

/**
 * Run a read-only `stellar contract invoke` (no --source needed for view
 * functions since stellar-cli simulation uses a fee-less dummy account).
 */
function runStellarQuery(bin, args) {
  return spawnSync(bin, ["contract", "invoke", ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });
}

/**
 * Print the captured output from a stellar-cli run, handling both success
 * and failure.  Returns true if the command succeeded.
 */
function handleResult(spinner, result, successMsg) {
  if (result.status === 0) {
    spinner.succeed(successMsg);
    if (result.stdout?.trim()) {
      console.log(chalk.gray(result.stdout.trim()));
    }
    return true;
  } else {
    spinner.fail("stellar-cli returned an error");
    const errText = (result.stderr ?? result.stdout ?? "").trim();
    console.error(chalk.red(errText || "Unknown error — run with STELLAR_CLI_DEBUG=true for details"));
    process.exit(1);
  }
}

// ─── Milestone ScVal builder ───────────────────────────────────────────────────
/**
 * Build the --milestones argument value for `stellar contract invoke create_escrow`.
 *
 * stellar-cli accepts Soroban values as JSON-like XDR argument strings on the
 * command line.  A Vec<Milestone> is passed as a JSON array where each element
 * is a map matching the Milestone struct field order:
 *   { title: String, amount: i128, status: MilestoneStatus::Pending, proof_url: "" }
 *
 * stellar-cli --arg-json mode uses the format:
 *   '[{"title":"…","amount":"<i128>","status":{"tag":"Pending"},"proof_url":""}]'
 */
function buildMilestonesJson(milestones) {
  return JSON.stringify(
    milestones.map(({ title, amount }) => ({
      title,
      amount: String(amount),
      status: { tag: "Pending" },
      proof_url: "",
    }))
  );
}

// ─── Command group ────────────────────────────────────────────────────────────

export function stellarWrapCommands(program) {
  const stellar = program
    .command("stellar")
    .description(
      "stellar-cli wrapper commands — shell out to the stellar binary\n" +
      chalk.gray("  Requires: cargo install --locked stellar-cli")
    );

  // ── stellar create-escrow ─────────────────────────────────────────────────
  stellar
    .command("create-escrow")
    .description("Create a new escrow agreement via stellar-cli")
    .requiredOption("--contributor <G...>",  "Stellar address of the contributor (worker)")
    .requiredOption("--arbitrator <G...>",   "Stellar address of the arbitrator")
    .requiredOption("--token <C...>",        "SEP-0041 token contract address (e.g. USDC)")
    .requiredOption("--deadline <ledger>",   "Absolute ledger number for the deadline")
    .requiredOption("--description <text>",  "Human-readable description for this escrow")
    .requiredOption(
      "--milestones <json>",
      'JSON array of milestones, e.g. \'[{"title":"Design","amount":"5000000"}]\''
    )
    .option("--source <key>",    "Named key or secret (S...) for signing (overrides STELLAR_SOURCE_KEY)")
    .option("--network <name>",  "Network alias (default: from STELLAR_NETWORK env)", NETWORK)
    .action(async (opts) => {
      const bin    = requireStellarCli();
      const source = resolveSourceKey(opts.source);
      const net    = opts.network ?? NETWORK;

      // Parse and validate milestones JSON early so we fail before shelling out
      let milestones;
      try {
        milestones = JSON.parse(opts.milestones);
        if (!Array.isArray(milestones) || milestones.length === 0) throw new Error("Must be a non-empty array");
        for (const m of milestones) {
          if (!m.title)  throw new Error(`Milestone missing "title" field`);
          if (!m.amount) throw new Error(`Milestone "${m.title}" missing "amount" field`);
        }
      } catch (err) {
        console.error(chalk.red(`❌  Invalid --milestones JSON: ${err.message}`));
        console.error(
          chalk.gray(
            "Example: --milestones '[{\"title\":\"Design\",\"amount\":\"5000000\"},{\"title\":\"Dev\",\"amount\":\"10000000\"}]'"
          )
        );
        process.exit(1);
      }

      const milestonesJson = buildMilestonesJson(milestones);

      // Derive the client address from the source key
      // stellar keys address <key-name> prints the public key
      let clientAddress;
      if (source.startsWith("S") && source.length === 56) {
        // It's a raw secret key — derive the public key via stellar-cli keys
        const keyResult = spawnSync(bin, ["keys", "address", "--secret-key", source], {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        if (keyResult.status === 0) {
          clientAddress = keyResult.stdout.trim();
        }
        // If that fails we'll let stellar-cli work it out from --source
      } else {
        // It's a named key
        const keyResult = spawnSync(bin, ["keys", "address", source], {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        if (keyResult.status === 0) {
          clientAddress = keyResult.stdout.trim();
        }
      }

      const spinner = ora("Creating escrow via stellar-cli…").start();

      const args = [
        "--id",       ESCROW_CONTRACT_ID,
        "--source",   source,
        "--",
        "create_escrow",
        "--client",          clientAddress ?? `key:${source}`,
        "--contributor",     opts.contributor,
        "--arbitrator",      opts.arbitrator,
        "--token",           opts.token,
        "--milestones",      milestonesJson,
        "--deadline_ledger", String(opts.deadline),
        "--description",     opts.description,
        ...commonFlags(net, RPC_URL),
      ];

      const result = runStellarInvoke(bin, args);

      if (result.status === 0) {
        spinner.succeed("Escrow created!");
        const output = result.stdout?.trim();
        if (output) {
          // stellar-cli prints the return value (escrow ID as u64)
          console.log(`\n${chalk.cyan("Escrow ID:")} ${chalk.bold.green(output)}`);
        }
        console.log(
          chalk.gray(
            `\nView on Stellar Expert: https://stellar.expert/explorer/${net}/contract/${ESCROW_CONTRACT_ID}`
          )
        );
      } else {
        handleResult(spinner, result, "");
      }
    });

  // ── stellar submit-milestone ──────────────────────────────────────────────
  stellar
    .command("submit-milestone")
    .description("Submit proof of completion for a milestone (contributor)")
    .requiredOption("--escrow <number>",   "Escrow ID (on-chain)")
    .requiredOption("--index <number>",    "Milestone index (0-based)")
    .requiredOption("--proof <url>",       "IPFS CID or HTTPS URL with proof of work")
    .option("--source <key>",  "Named key or secret (S...) for signing")
    .option("--network <name>", "Network alias", NETWORK)
    .action(async (opts) => {
      const bin    = requireStellarCli();
      const source = resolveSourceKey(opts.source);
      const net    = opts.network ?? NETWORK;

      // Derive contributor address from source key
      let contribAddress;
      const addrArgs = source.startsWith("S") && source.length === 56
        ? ["keys", "address", "--secret-key", source]
        : ["keys", "address", source];
      const addrResult = spawnSync(bin, addrArgs, {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (addrResult.status === 0) {
        contribAddress = addrResult.stdout.trim();
      }

      const spinner = ora(
        `Submitting milestone #${opts.index} for escrow #${opts.escrow}…`
      ).start();

      const args = [
        "--id",     ESCROW_CONTRACT_ID,
        "--source", source,
        "--",
        "submit_milestone",
        "--contributor",     contribAddress ?? `key:${source}`,
        "--escrow_id",       String(opts.escrow),
        "--milestone_index", String(opts.index),
        "--proof_url",       opts.proof,
        ...commonFlags(net, RPC_URL),
      ];

      const result = runStellarInvoke(bin, args);
      handleResult(
        spinner,
        result,
        `Milestone #${opts.index} submitted for escrow #${opts.escrow}`
      );
      if (result.status === 0) {
        console.log(chalk.gray(`Proof: ${opts.proof}`));
      }
    });

  // ── stellar approve-milestone ─────────────────────────────────────────────
  stellar
    .command("approve-milestone")
    .description("Approve a submitted milestone and release its funds (client)")
    .requiredOption("--escrow <number>",  "Escrow ID (on-chain)")
    .requiredOption("--index <number>",   "Milestone index (0-based)")
    .option("--source <key>",  "Named key or secret (S...) for signing")
    .option("--network <name>", "Network alias", NETWORK)
    .action(async (opts) => {
      const bin    = requireStellarCli();
      const source = resolveSourceKey(opts.source);
      const net    = opts.network ?? NETWORK;

      // Derive client address from source key
      let clientAddress;
      const addrArgs = source.startsWith("S") && source.length === 56
        ? ["keys", "address", "--secret-key", source]
        : ["keys", "address", source];
      const addrResult = spawnSync(bin, addrArgs, {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (addrResult.status === 0) {
        clientAddress = addrResult.stdout.trim();
      }

      const spinner = ora(
        `Approving milestone #${opts.index} for escrow #${opts.escrow}…`
      ).start();

      const args = [
        "--id",     ESCROW_CONTRACT_ID,
        "--source", source,
        "--",
        "approve_milestone",
        "--client",          clientAddress ?? `key:${source}`,
        "--escrow_id",       String(opts.escrow),
        "--milestone_index", String(opts.index),
        ...commonFlags(net, RPC_URL),
      ];

      const result = runStellarInvoke(bin, args);
      handleResult(
        spinner,
        result,
        `Milestone #${opts.index} approved — funds released to contributor`
      );
    });

  // ── stellar check-balance ─────────────────────────────────────────────────
  stellar
    .command("check-balance")
    .description("Check the unreleased token balance of an escrow")
    .requiredOption("--escrow <number>", "Escrow ID (on-chain)")
    .option("--network <name>", "Network alias", NETWORK)
    .action(async (opts) => {
      const bin = requireStellarCli();
      const net = opts.network ?? NETWORK;

      const spinner = ora(
        `Checking balance for escrow #${opts.escrow}…`
      ).start();

      // get_balance is a read-only view function; no --source required.
      // stellar-cli will simulate with a dummy account.
      const args = [
        "--id", ESCROW_CONTRACT_ID,
        "--",
        "get_balance",
        "--escrow_id", String(opts.escrow),
        ...commonFlags(net, RPC_URL),
      ];

      const result = runStellarQuery(bin, args);

      if (result.status === 0) {
        spinner.stop();
        const raw = result.stdout?.trim() ?? "0";

        // stellar-cli returns i128 as a plain decimal string
        let formatted = raw;
        try {
          const n = BigInt(raw);
          const whole = n / BigInt(1e7);
          const frac  = n % BigInt(1e7);
          formatted = frac === 0n
            ? `${whole.toLocaleString()} tokens`
            : `${whole.toLocaleString()}.${frac.toString().padStart(7, "0").replace(/0+$/, "")} tokens`;
        } catch { /* leave as raw if not numeric */ }

        console.log(`\n${chalk.bold(`💰 Escrow #${opts.escrow} — Unreleased Balance`)}`);
        console.log(chalk.gray("─".repeat(45)));
        console.log(`${chalk.cyan("Balance:")} ${chalk.bold.yellow(formatted)}`);
        console.log(chalk.gray(`(raw i128: ${raw})`));
        console.log(
          chalk.gray(
            `\nView on Stellar Expert: https://stellar.expert/explorer/${net}/contract/${ESCROW_CONTRACT_ID}`
          )
        );
      } else {
        handleResult(spinner, result, "");
      }
    });

  // ── stellar version ───────────────────────────────────────────────────────
  stellar
    .command("version")
    .description("Show the installed stellar-cli version")
    .action(() => {
      const bin = requireStellarCli();
      const result = spawnSync(bin, ["version"], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (result.status === 0) {
        console.log(chalk.cyan("stellar-cli ") + result.stdout.trim());
      } else {
        console.error(chalk.red("Could not determine stellar-cli version"));
        process.exit(1);
      }
    });
}
