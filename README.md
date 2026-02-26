# 🍬 SolCrush — PvP Match-3 Wagering on Solana

> **Trustless PvP match-3. Stake SOL or USDC. Winner takes all.**
> Real-time gameplay via MagicBlock Ephemeral Rollups. On-chain escrow. No custodians.

🌐 **[Play on Devnet → solcrush.vercel.app](https://solcrush.vercel.app)**

---

## 🏆 Hackathon Submission

| | |
|---|---|
| **Event** | Graveyard Hack 2025 |
| **Track** | MagicBlock Gaming ($5,000 prize pool) |
| **Category** | Resurrect Gaming on Solana |
| **Builder** | [@0xaasis](https://github.com/0xaasis) |

---

## 🎮 What Is SolCrush?

Two players stake SOL or USDC, play identical match-3 boards simultaneously for 4 rounds, and the higher score wins the full pot minus a 2.5% platform fee — all settled trustlessly on-chain.

**The house never touches the funds. The escrow PDA holds everything.**

```
Player 1 stakes 5 USDC ──┐
                          ├──► Escrow PDA ──► Winner gets 9.75 USDC
Player 2 stakes 5 USDC ──┘                   Treasury gets 0.25 USDC
```

---

## ⚡ MagicBlock Integration

SolCrush uses **MagicBlock Ephemeral Rollups** to solve the core problem of on-chain gaming: Solana's 400ms block time is too slow for real-time match-3 gameplay.

### How It Works

```
create_match()     → Solana L1  (escrow created, funds locked)
join_match()       → Solana L1  (P2 deposits, match activated)
delegate_match()   → L1 → Rollup (PDA ownership transferred)
─────────────────────────────────────────────────────────────
[4 rounds of gameplay happen here on Ephemeral Rollup]
  • Sub-100ms move validation
  • Zero fees per move
  • Real Solana accounts, real state
─────────────────────────────────────────────────────────────
commit_match()     → Rollup → L1 (final scores written back)
resolve_match()    → Solana L1  (winner paid, escrow closed)
```

### Why This Matters

Without MagicBlock, every gem swap would require an L1 transaction (~400ms, ~$0.001). A 4-round match has hundreds of moves — that's minutes of lag and real transaction fees per game.

With Ephemeral Rollups: the entire match costs the same as **3 L1 transactions total**.

### Magic Router

The frontend uses Magic Router (`devnet-router.magicblock.app`) which auto-routes transactions to the rollup or L1 based on delegation status — no special logic needed in the UI.

---

## 🔐 On-Chain Architecture

### Smart Contract (Anchor 0.29)

| Instruction | What it does |
|---|---|
| `initialize_match` | P1 creates escrow PDA, deposits stake |
| `deposit_stake` | P2 joins, deposits matching stake |
| `delegate_match` | Transfers PDA to MagicBlock delegation program |
| `commit_match` | Commits rollup state back to L1 |
| `resolve_match` | Pays winner, sends 2.5% fee to treasury |
| `cancel_match` | Refunds both players (timeout protection) |

### PDA Seeds
```
Escrow PDA: ["escrow", match_id_32_bytes]
Vault PDA:  ["vault",  match_id_32_bytes]  ← holds USDC
```

### Security
- ✅ PDA escrow — neither player controls funds unilaterally
- ✅ Winner must be P1 or P2 — no fake winners possible
- ✅ Double-payout prevented — status → `Resolved` before transfer
- ✅ Checked arithmetic everywhere — no overflow
- ✅ Cancel timeout — 10 min protection against abandoned matches
- ✅ Rent reclaimed when vault closes

---

## 🎯 Anti-Cheat: Dual-Submit Replay Consensus

Both players submit their complete move log at match end. The server replays both logs deterministically on the same seeded board and compares scores. If they match → result is valid. If not → dispute flagged.

```typescript
// Both players send: { moves: Move[], seed: number, score: number }
// Server replays both logs independently
const p1Verified = replayEngine.replay(p1Moves, boardSeed);
const p2Verified = replayEngine.replay(p2Moves, boardSeed);
// Scores must match within tolerance
```

---

## 🖥️ Tech Stack

| Layer | Tech |
|---|---|
| Smart Contract | Anchor 0.29, Rust |
| Rollup Integration | MagicBlock Ephemeral Rollups SDK |
| Frontend | Next.js 14, React 18, TypeScript |
| Wallet | @solana/wallet-adapter (Phantom, Solflare, Coinbase) |
| Token | @solana/spl-token (USDC + native SOL) |
| Game Server | Node.js WebSocket |
| Anti-Cheat | Deterministic replay engine |

---

## 📁 Repository Structure

```
solcrush/
├── program/                         ← Anchor smart contract
│   └── src/
│       ├── lib.rs                   ← 6 instructions
│       ├── state.rs                 ← MatchEscrow account
│       ├── errors.rs                ← Custom error codes
│       └── instructions/
│           ├── initialize_match.rs  ← P1 creates escrow
│           ├── deposit_stake.rs     ← P2 deposits
│           ├── delegate_match.rs    ← 🔮 MagicBlock delegate
│           ├── commit_match.rs      ← 🔮 MagicBlock commit
│           ├── resolve_match.rs     ← Pay winner + fee
│           └── cancel_match.rs     ← Refund players
│
├── frontend/
│   └── src/
│       ├── components/SolCrush.tsx  ← Full game UI
│       ├── lib/solcrushChain.ts     ← Blockchain client
│       ├── lib/rollupClient.ts      ← 🔮 MagicBlock client
│       └── lib/idl.json            ← Program IDL
│
├── scripts/
│   ├── deploy.sh                   ← One-command deploy
│   └── test-staking.ts             ← E2E test
│
└── vercel.json
```

🔮 = MagicBlock-specific files

---

## 🚀 Try It (Devnet)

1. Go to **[solcrush.vercel.app](https://solcrush.vercel.app)**
2. Connect **Phantom wallet** (switch to Devnet in settings)
3. Get devnet SOL: `solana airdrop 2 YOUR_WALLET`
4. Pick a stake amount → click **Find Match**
5. Sign the deposit transaction
6. Play 4 rounds of match-3
7. Winner receives payout automatically on-chain
8. Check your transaction on **Solana Explorer**

---

## 💰 Payout Math

```
Prize pool  = stake × 2
Fee         = prize pool × 2.5%
Winner gets = prize pool − fee

Example (5 USDC stake):
  Pool:   10.00 USDC
  Fee:     0.25 USDC → treasury
  Winner:  9.75 USDC → winner wallet
```

---

## 🪦 Why "Graveyard Hack"?

Gaming on Solana died because:
- L1 is too slow for real-time gameplay
- On-chain moves cost real fees
- Developers gave up and went fully off-chain

SolCrush resurrects it by combining:
- **MagicBlock** for sub-100ms gameplay with zero move fees
- **Anchor PDA escrow** for trustless fund custody
- **SPL token support** for USDC + native SOL wagering

The game is competitive, the stakes are real, and the chain is the referee.

---

*Built for the Graveyard Hack — MagicBlock Gaming Track 🎮🍬*
