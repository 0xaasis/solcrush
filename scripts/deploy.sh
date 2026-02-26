#!/usr/bin/env bash
# SolCrush On-Chain Staking — Deploy Script
# Run: chmod +x scripts/deploy.sh && ./scripts/deploy.sh
set -euo pipefail

GREEN='\033[0;32m'; BLUE='\033[0;34m'; RED='\033[0;31m'; NC='\033[0m'
log() { echo -e "${BLUE}[SolCrush]${NC} $1"; }
ok()  { echo -e "${GREEN}[✓]${NC} $1"; }
die() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ── Check tools ───────────────────────────────────────────────────────────────
command -v solana >/dev/null || die "solana CLI not found. Install: https://docs.solana.com/cli/install"
command -v anchor  >/dev/null || die "anchor not found. Install: cargo install --git https://github.com/coral-xyz/anchor avm --locked && avm install 0.29.0"
command -v node    >/dev/null || die "node not found"

log "SolCrush On-Chain Staking — Deployment"
echo ""

# ── Set devnet ────────────────────────────────────────────────────────────────
solana config set --url devnet
WALLET=$(solana address)
log "Wallet: $WALLET"

# ── Airdrop if needed ─────────────────────────────────────────────────────────
BALANCE=$(solana balance | awk '{print $1}')
log "Balance: ${BALANCE} SOL"
if (( $(echo "$BALANCE < 2" | bc -l) )); then
  log "Airdropping SOL..."
  solana airdrop 2 || true
  sleep 3
  solana airdrop 2 || true
  sleep 3
fi

# ── Build ─────────────────────────────────────────────────────────────────────
log "Building Anchor program..."
anchor build
ok "Build complete"

# ── Get program ID ────────────────────────────────────────────────────────────
PROGRAM_ID=$(solana-keygen pubkey target/deploy/solcrush_staking-keypair.json)
log "Program ID: $PROGRAM_ID"

# ── Update declare_id and Anchor.toml ────────────────────────────────────────
sed -i.bak "s/declare_id!(\".*\")/declare_id!(\"$PROGRAM_ID\")/" program/src/lib.rs
sed -i.bak "s/solcrush_staking = \"REPLACE_AFTER_DEPLOY\"/solcrush_staking = \"$PROGRAM_ID\"/" Anchor.toml
sed -i.bak "s/\"address\": \"REPLACE_AFTER_DEPLOY\"/\"address\": \"$PROGRAM_ID\"/" frontend/src/lib/idl.json

# Rebuild with correct ID
anchor build
ok "Rebuilt with correct program ID"

# ── Deploy ────────────────────────────────────────────────────────────────────
log "Deploying to devnet..."
anchor deploy --provider.cluster devnet
ok "Program deployed: $PROGRAM_ID"
echo "   https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"

# ── Update frontend .env.local ────────────────────────────────────────────────
ENV_FILE="frontend/.env.local"
if [ -f "$ENV_FILE" ]; then
  sed -i.bak "s/NEXT_PUBLIC_PROGRAM_ID=.*/NEXT_PUBLIC_PROGRAM_ID=$PROGRAM_ID/" "$ENV_FILE"
  sed -i.bak "s/NEXT_PUBLIC_TREASURY=.*/NEXT_PUBLIC_TREASURY=$WALLET/" "$ENV_FILE"
  ok "Updated $ENV_FILE"
fi

# ── Setup devnet USDC ─────────────────────────────────────────────────────────
log "Setting up devnet USDC..."
NEXT_PUBLIC_PROGRAM_ID=$PROGRAM_ID npx ts-node scripts/setup-devnet-usdc.ts
ok "USDC setup complete"

echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  Deployment complete!${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""
echo "  Program ID:  $PROGRAM_ID"
echo "  Treasury:    $WALLET"
echo "  Explorer:    https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
echo ""
echo "  Next steps:"
echo "  1. cd frontend && npm run dev"
echo "  2. Connect wallet to devnet"
echo "  3. Play SolCrush with real stakes!"
echo ""
