# SolCrush — On-Chain Staking

> PvP Match-3 with real SOL & USDC staking on Solana devnet.
> 2× your stake when you win. 2.5% platform fee. No custodians.

---

## What's New (vs simulated version)

| Feature | Before | After |
|---|---|---|
| Staking | Simulated | Real SOL/USDC on-chain |
| Escrow | None | Anchor PDA escrow |
| Payout | Fake number | On-chain token transfer |
| Verification | None | Explorer-visible txns |

---

## Architecture

```
Player clicks "Find Match"
       │
       ▼
initializeMatch()  ← P1 deposits stake into escrow PDA
       │
       ▼
depositStake()     ← P2 deposits matching stake
       │
       ▼
  [Game plays]
       │
       ▼
resolveMatch()     ← Winner gets 2× stake − 2.5% fee
                      Treasury gets 2.5% fee
```

### PDA Seeds
- Escrow: `["escrow", match_id_32_bytes]`
- Vault:  `["vault",  match_id_32_bytes]`

---

## Step-by-Step: Run Locally

### Prerequisites
```bash
# 1. Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 2. Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/v1.18.4/install)"

# 3. Install Anchor
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.29.0
avm use 0.29.0

# 4. Create/set devnet wallet
solana-keygen new           # creates ~/.config/solana/id.json
solana config set --url devnet
solana airdrop 2
```

### Deploy the Program
```bash
# From repo root:
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```
This will:
- Build the Anchor program
- Deploy to devnet
- Auto-update `frontend/.env.local` with the program ID
- Create a test USDC mint
- Mint 10,000 test USDC to your wallet

### Run the Frontend
```bash
cd frontend
npm install
npm run dev
# Open http://localhost:3000
```

### Test with Two Wallets
1. Open Chrome with Phantom wallet (Player 1)
2. Open a different browser or incognito with another Phantom wallet (Player 2)
3. Both switch to **Devnet** in Phantom settings
4. Both airdrop SOL: `solana airdrop 2 <WALLET_ADDRESS>`
5. Player 1 clicks Find Match → signs deposit tx
6. Player 2 does the same (they'll match via game server)
7. Game runs → winner auto-receives payout on-chain

---

## Step-by-Step: Deploy to Vercel

```bash
# 1. Push to GitHub
./PUSH_TO_GITHUB.bat    # Windows
# OR
git push origin main    # Mac/Linux

# 2. Go to vercel.com → Add New Project → Import solcrush
# 3. Root Directory = frontend
# 4. Add Environment Variables in Vercel dashboard:
#    NEXT_PUBLIC_PROGRAM_ID = (from deploy.sh output)
#    NEXT_PUBLIC_USDC_MINT  = (from deploy.sh output)
#    NEXT_PUBLIC_TREASURY   = (your wallet pubkey)
#    NEXT_PUBLIC_RPC_ENDPOINT = https://api.devnet.solana.com
# 5. Deploy!
```

---

## Run Tests
```bash
cd scripts
npm install

# End-to-end test (creates two wallets, stakes, resolves)
NEXT_PUBLIC_PROGRAM_ID=YOUR_PROGRAM_ID ts-node test-staking.ts
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_PROGRAM_ID` | Deployed Anchor program ID |
| `NEXT_PUBLIC_USDC_MINT` | USDC SPL token mint address |
| `NEXT_PUBLIC_TREASURY` | Your wallet (receives 2.5% fees) |
| `NEXT_PUBLIC_RPC_ENDPOINT` | Solana RPC URL |
| `NEXT_PUBLIC_SOLANA_NETWORK` | `devnet` or `mainnet-beta` |

---

## File Structure

```
solcrush/
├── program/                    ← Anchor smart contract (Rust)
│   └── src/
│       ├── lib.rs              ← Program entry point
│       ├── state.rs            ← MatchEscrow account
│       ├── errors.rs           ← Custom error codes
│       └── instructions/
│           ├── initialize_match.rs  ← P1 creates + deposits
│           ├── deposit_stake.rs     ← P2 joins + deposits
│           ├── resolve_match.rs     ← Pay winner, take fee
│           └── cancel_match.rs     ← Refund both players
│
├── frontend/
│   └── src/
│       ├── app/
│       │   ├── page.tsx
│       │   ├── layout.tsx
│       │   └── globals.css
│       ├── components/
│       │   └── SolCrush.tsx        ← Game UI + blockchain calls
│       ├── providers/
│       │   └── WalletProvider.tsx
│       └── lib/
│           ├── solcrushChain.ts    ← All blockchain functions
│           └── idl.json            ← Program interface
│
├── scripts/
│   ├── deploy.sh               ← One-command deploy
│   ├── setup-devnet-usdc.ts    ← Create test USDC
│   └── test-staking.ts         ← E2E test
│
├── vercel.json
├── Anchor.toml
└── PUSH_TO_GITHUB.bat
```

---

## On-Chain Safety

- ✅ PDA escrow — neither player can drain funds unilaterally
- ✅ `resolve_match` only callable by match participants
- ✅ Winner must be P1 or P2 — no fake winners
- ✅ Checked arithmetic — no overflow
- ✅ Double-payout prevented — status set to `Resolved` before transfer
- ✅ Cancel timeout — 10 minutes before active match can be cancelled
- ✅ Rent reclaimed when vault closes

---

## Explorer Links

After any transaction the UI shows a **View ↗** link.
Direct link pattern:
```
https://explorer.solana.com/tx/SIGNATURE?cluster=devnet
```

---

Built for the Solana Graveyard Hack — MagicBlock Gaming Track 🎮
