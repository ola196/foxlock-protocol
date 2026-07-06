#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Build and deploy escrow + reputation contracts to Stellar Testnet
#
# Prerequisites:
#   - Rust + cargo installed (rustup.rs)
#   - stellar-cli installed: cargo install --locked stellar-cli
#   - A funded testnet account (use `stellar keys generate` + friendbot)
#
# Usage:
#   chmod +x scripts/deploy.sh
#   DEPLOYER_KEY=my-key-name ./scripts/deploy.sh
# =============================================================================
set -euo pipefail

NETWORK="testnet"
RPC_URL="https://soroban-testnet.stellar.org"
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
DEPLOYER_KEY="${DEPLOYER_KEY:-default}"

echo "╔══════════════════════════════════════════════╗"
echo "║  Soroban Milestone Escrow — Testnet Deploy  ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── 1. Build contracts ────────────────────────────────────────────────────────
echo "▶ Building contracts..."
stellar contract build

echo ""
echo "▶ Optimizing WASM..."
stellar contract optimize \
    --wasm target/wasm32v1-none/release/escrow.wasm \
    --wasm-out target/wasm32v1-none/release/escrow.optimized.wasm

stellar contract optimize \
    --wasm target/wasm32v1-none/release/reputation.wasm \
    --wasm-out target/wasm32v1-none/release/reputation.optimized.wasm

# ── 2. Deploy escrow contract ────────────────────────────────────────────────
echo ""
echo "▶ Deploying Escrow contract..."
ESCROW_ID=$(stellar contract deploy \
    --wasm target/wasm32v1-none/release/escrow.optimized.wasm \
    --source "$DEPLOYER_KEY" \
    --network "$NETWORK")

echo "✅ Escrow contract deployed: $ESCROW_ID"

# ── 3. Deploy reputation contract ────────────────────────────────────────────
echo ""
echo "▶ Deploying Reputation contract..."
REPUTATION_ID=$(stellar contract deploy \
    --wasm target/wasm32v1-none/release/reputation.optimized.wasm \
    --source "$DEPLOYER_KEY" \
    --network "$NETWORK")

echo "✅ Reputation contract deployed: $REPUTATION_ID"

# ── 4. Initialize reputation contract ────────────────────────────────────────
echo ""
echo "▶ Initializing Reputation contract with operator..."
DEPLOYER_ADDRESS=$(stellar keys address "$DEPLOYER_KEY")

stellar contract invoke \
    --id "$REPUTATION_ID" \
    --source "$DEPLOYER_KEY" \
    --network "$NETWORK" \
    -- initialize \
    --operator "$DEPLOYER_ADDRESS"

echo "✅ Reputation contract initialized."

# ── 5. Generate TypeScript bindings ──────────────────────────────────────────
echo ""
echo "▶ Generating TypeScript bindings..."
mkdir -p frontend/src/contracts

stellar contract bindings typescript \
    --wasm target/wasm32v1-none/release/escrow.optimized.wasm \
    --contract-id "$ESCROW_ID" \
    --output-dir frontend/src/contracts/escrow \
    --network "$NETWORK"

stellar contract bindings typescript \
    --wasm target/wasm32v1-none/release/reputation.optimized.wasm \
    --contract-id "$REPUTATION_ID" \
    --output-dir frontend/src/contracts/reputation \
    --network "$NETWORK"

echo "✅ TypeScript bindings generated."

# ── 6. Write .env for frontend ────────────────────────────────────────────────
cat > frontend/.env.local <<EOF
NEXT_PUBLIC_ESCROW_CONTRACT_ID=$ESCROW_ID
NEXT_PUBLIC_REPUTATION_CONTRACT_ID=$REPUTATION_ID
NEXT_PUBLIC_NETWORK=testnet
NEXT_PUBLIC_RPC_URL=$RPC_URL
NEXT_PUBLIC_NETWORK_PASSPHRASE="$NETWORK_PASSPHRASE"
EOF

echo ""
echo "✅ .env.local written to frontend/"
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║              Deployment Complete             ║"
echo "╠══════════════════════════════════════════════╣"
echo "║  Escrow:     $ESCROW_ID"
echo "║  Reputation: $REPUTATION_ID"
echo "╚══════════════════════════════════════════════╝"
