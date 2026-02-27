# SolCrush 🍬

PvP match-3 on Solana. You stake, you play, winner gets paid. All on-chain, no backend holding your funds.

[solcrush.vercel.app](https://solcrush.vercel.app) · Devnet · [Demo Video](https://youtube.com/shorts/NQJ36sAJaD4?feature=share)
---

## What's this?

Basically Candy Crush but you're wagering real tokens against another player. Both players stake the same amount, play a 4-round match-3 game, and whoever scores higher wins the pot. The escrow is a PDA so neither player can touch the funds until the match resolves.

Built for the MagicBlock Gaming track at Graveyard Hack 2025.

```
you stake 5 USDC
opponent stakes 5 USDC
   -> escrow PDA holds 10 USDC
   -> you win
   -> you get 9.75 USDC, treasury gets 0.25
```

No custodian. No trust required.

---

## The MagicBlock part

The real problem with on-chain gaming is that Solana's 400ms block time makes real-time gameplay feel broken. Every move can't be a transaction, that's unusable.

MagicBlock's ephemeral rollups fix this. The escrow gets created on L1, then the match account gets delegated to the rollup. Gameplay happens there, sub-100ms, zero fees per move. When the match ends, scores get committed back to L1 and the winner gets paid out.

The whole match = 3 L1 transactions. Everything in between is free.

```
initialize_match()  ->  L1    (lock funds)
delegate_match()    ->  L1 -> Rollup
  ... gameplay on rollup ...
commit_match()      ->  Rollup -> L1
resolve_match()     ->  L1    (pay winner)
```

---

## Program

Deployed on devnet: `7LLvnnLaqME25Kuf7Q6nUgFrrKKSWxUNdC62fFV21eZs`

[View on Explorer](https://explorer.solana.com/address/7LLvnnLaqME25Kuf7Q6nUgFrrKKSWxUNdC62fFV21eZs?cluster=devnet)

Written in Anchor. Four core instructions:

- `initialize_match` — P1 creates the escrow PDA and locks their stake
- `deposit_stake` — P2 joins and deposits, match goes active
- `resolve_match` — checks winner is P1 or P2, pays out, closes vault
- `cancel_match` — refunds both players if someone bails (10 min timeout)

PDA seeds are `["escrow", match_id]` where match_id is 32 random bytes generated client-side. Resolve marks status as Resolved before the transfer, checked arithmetic throughout, rent reclaimed on close.

---

## Anti-cheat

Both players submit their full move log at match end. The server replays both logs on the same seeded board and checks if scores match. Same moves on the same seed always produce the same result so scores can't be faked.

---

## Stack

- Anchor 0.29 / Rust
- MagicBlock Ephemeral Rollups SDK
- Next.js 14 + TypeScript
- @solana/wallet-adapter (Phantom, Solflare, Coinbase Wallet)
- SPL token for USDC + native SOL

---

## Repo structure

```
solcrush/
├── program/src/
│   ├── lib.rs
│   ├── state.rs          <- MatchEscrow account (158 bytes)
│   ├── errors.rs         <- 9 custom errors
│   └── instructions/
│       ├── initialize_match.rs
│       ├── deposit_stake.rs
│       ├── resolve_match.rs
│       └── cancel_match.rs
│
├── frontend/src/
│   ├── components/SolCrush.tsx   <- game UI
│   ├── lib/solcrushChain.ts      <- on-chain client
│   └── lib/idl.json
│
└── scripts/
    └── test-staking.ts
```

---

## Try it

1. Open [solcrush.vercel.app](https://solcrush.vercel.app)
2. Connect Phantom on Devnet
3. Get devnet SOL from [faucet.solana.com](https://faucet.solana.com) if needed
4. Pick a stake, click Find Match, sign the tx
5. Play 4 rounds
6. Check the tx on [Solana Explorer](https://explorer.solana.com/?cluster=devnet)

---

## Payout

```
pool    = stake x 2
fee     = pool x 2.5%
winner  = pool - fee
```

5 USDC stake means winner gets 9.75 USDC.

---

Built for Graveyard Hack 2025 — MagicBlock Gaming track 🎮
