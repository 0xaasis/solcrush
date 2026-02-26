/**
 * solcrushChain.ts
 * Complete on-chain staking client for SolCrush
 * Handles: createMatch, depositStake, resolveMatch, cancelMatch
 */

import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Commitment,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Program, AnchorProvider, BN, web3 } from '@coral-xyz/anchor';
import { WalletContextState } from '@solana/wallet-adapter-react';
import IDL from './idl.json';

// ─── Constants ───────────────────────────────────────────────────────────────

export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID || 'REPLACE_AFTER_DEPLOY'
);

export const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
);

export const TREASURY = new PublicKey(
  process.env.NEXT_PUBLIC_TREASURY || 'REPLACE_WITH_TREASURY_WALLET'
);

export const RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_RPC_ENDPOINT || 'https://api.devnet.solana.com';

/** USDC has 6 decimal places */
export const USDC_DECIMALS = 6;

// ─── PDA helpers ─────────────────────────────────────────────────────────────

export function getEscrowPDA(matchId: Uint8Array): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), Buffer.from(matchId)],
    PROGRAM_ID
  );
}

export function getVaultPDA(matchId: Uint8Array): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), Buffer.from(matchId)],
    PROGRAM_ID
  );
}

/** Generate a unique 32-byte match ID */
export function generateMatchId(): Uint8Array {
  const id = new Uint8Array(32);
  crypto.getRandomValues(id);
  return id;
}

/** Convert match ID to hex string for display/storage */
export function matchIdToHex(id: Uint8Array): string {
  return Array.from(id).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Amount helpers ───────────────────────────────────────────────────────────

/** Convert display amount to on-chain units */
export function toChainAmount(amount: number, isSol: boolean): BN {
  if (isSol) {
    return new BN(Math.floor(amount * LAMPORTS_PER_SOL));
  } else {
    return new BN(Math.floor(amount * Math.pow(10, USDC_DECIMALS)));
  }
}

/** Convert on-chain units to display amount */
export function fromChainAmount(amount: BN, isSol: boolean): number {
  if (isSol) {
    return amount.toNumber() / LAMPORTS_PER_SOL;
  } else {
    return amount.toNumber() / Math.pow(10, USDC_DECIMALS);
  }
}

// ─── Provider setup ───────────────────────────────────────────────────────────

export function getProgram(
  wallet: WalletContextState,
  connection: Connection
): Program {
  const provider = new AnchorProvider(
    connection,
    wallet as any,
    { commitment: 'confirmed', preflightCommitment: 'confirmed' }
  );
  return new Program(IDL as any, PROGRAM_ID, provider);
}

// ─── Transaction helpers ──────────────────────────────────────────────────────

/** Ensure an ATA exists, return instruction to create it if not */
async function ensureATA(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
  payer: PublicKey
): Promise<{ ata: PublicKey; createIx: web3.TransactionInstruction | null }> {
  const ata = await getAssociatedTokenAddress(mint, owner, false);
  const info = await connection.getAccountInfo(ata);
  const createIx = info
    ? null
    : createAssociatedTokenAccountInstruction(payer, ata, owner, mint);
  return { ata, createIx };
}

// ─── Main client class ────────────────────────────────────────────────────────

export class SolCrushChain {
  private program: Program;
  private connection: Connection;
  private wallet: WalletContextState;

  constructor(wallet: WalletContextState, connection: Connection) {
    this.wallet = wallet;
    this.connection = connection;
    this.program = getProgram(wallet, connection);
  }

  /**
   * STEP 1: P1 creates the escrow and deposits their stake.
   * Returns { matchId, escrowPDA, signature }
   */
  async createMatch(
    stakeAmount: number,
    isSol: boolean
  ): Promise<{ matchId: Uint8Array; escrowPDA: PublicKey; signature: string }> {
    const playerOne = this.wallet.publicKey!;
    const matchId = generateMatchId();
    const [escrowPDA] = getEscrowPDA(matchId);
    const [vaultPDA] = getVaultPDA(matchId);
    const chainAmount = toChainAmount(stakeAmount, isSol);
    const mint = USDC_MINT;

    let tx: Transaction;

    if (isSol) {
      // SOL path — use a dummy mint pubkey (SOL has no mint)
      const dummyMint = SystemProgram.programId;
      tx = await (this.program.methods as any)
        .initializeMatch(Array.from(matchId), chainAmount, true)
        .accounts({
          matchEscrow: escrowPDA,
          vault: vaultPDA,
          tokenMint: dummyMint,
          playerOneAta: playerOne, // unused for SOL
          playerOne,
          treasury: TREASURY,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: web3.SYSVAR_RENT_PUBKEY,
        })
        .transaction();
    } else {
      // USDC path
      const { ata: playerOneAta, createIx } = await ensureATA(
        this.connection, mint, playerOne, playerOne
      );

      tx = await (this.program.methods as any)
        .initializeMatch(Array.from(matchId), chainAmount, false)
        .accounts({
          matchEscrow: escrowPDA,
          vault: vaultPDA,
          tokenMint: mint,
          playerOneAta,
          playerOne,
          treasury: TREASURY,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: web3.SYSVAR_RENT_PUBKEY,
        })
        .transaction();

      if (createIx) tx.instructions.unshift(createIx);
    }

    const signature = await this.sendTx(tx);
    return { matchId, escrowPDA, signature };
  }

  /**
   * STEP 2: P2 deposits their matching stake.
   * Called when matchmaking finds an opponent.
   */
  async depositStake(
    matchId: Uint8Array,
    isSol: boolean
  ): Promise<string> {
    const playerTwo = this.wallet.publicKey!;
    const [escrowPDA] = getEscrowPDA(matchId);
    const [vaultPDA] = getVaultPDA(matchId);
    const mint = USDC_MINT;

    let tx: Transaction;

    if (isSol) {
      tx = await (this.program.methods as any)
        .depositStake()
        .accounts({
          matchEscrow: escrowPDA,
          vault: vaultPDA,
          tokenMint: SystemProgram.programId,
          playerTwoAta: playerTwo,
          playerTwo,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .transaction();
    } else {
      const { ata: playerTwoAta, createIx } = await ensureATA(
        this.connection, mint, playerTwo, playerTwo
      );

      tx = await (this.program.methods as any)
        .depositStake()
        .accounts({
          matchEscrow: escrowPDA,
          vault: vaultPDA,
          tokenMint: mint,
          playerTwoAta,
          playerTwo,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      if (createIx) tx.instructions.unshift(createIx);
    }

    return this.sendTx(tx);
  }

  /**
   * STEP 3: Winner calls this after game ends.
   * Pays winner (2× stake − 2.5% fee). Fee → treasury.
   */
  async resolveMatch(
    matchId: Uint8Array,
    playerOnePubkey: PublicKey,
    playerTwoPubkey: PublicKey,
    isSol: boolean,
    winner: PublicKey
  ): Promise<string> {
    const caller = this.wallet.publicKey!;
    const [escrowPDA] = getEscrowPDA(matchId);
    const [vaultPDA] = getVaultPDA(matchId);
    const mint = USDC_MINT;

    let accounts: Record<string, PublicKey>;

    if (isSol) {
      accounts = {
        matchEscrow: escrowPDA,
        vault: vaultPDA,
        tokenMint: SystemProgram.programId,
        caller,
        playerOne: playerOnePubkey,
        playerTwo: playerTwoPubkey,
        playerOneAta: playerOnePubkey,
        playerTwoAta: playerTwoPubkey,
        treasury: TREASURY,
        treasuryAta: TREASURY,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      };
    } else {
      const [p1Ata] = await Promise.all([
        getAssociatedTokenAddress(mint, playerOnePubkey),
      ]);
      const p2Ata = await getAssociatedTokenAddress(mint, playerTwoPubkey);
      const treasuryAta = await getAssociatedTokenAddress(mint, TREASURY);

      // Ensure treasury ATA exists
      const treasuryAtaInfo = await this.connection.getAccountInfo(treasuryAta);
      const tx = await (this.program.methods as any)
        .resolveMatch(winner)
        .accounts({
          matchEscrow: escrowPDA,
          vault: vaultPDA,
          tokenMint: mint,
          caller,
          playerOne: playerOnePubkey,
          playerTwo: playerTwoPubkey,
          playerOneAta: p1Ata,
          playerTwoAta: p2Ata,
          treasury: TREASURY,
          treasuryAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      if (!treasuryAtaInfo) {
        tx.instructions.unshift(
          createAssociatedTokenAccountInstruction(caller, treasuryAta, TREASURY, mint)
        );
      }

      return this.sendTx(tx);
    }

    const tx = await (this.program.methods as any)
      .resolveMatch(winner)
      .accounts(accounts)
      .transaction();

    return this.sendTx(tx);
  }

  /**
   * Cancel match and refund both players.
   * Only works after 10-minute timeout for active matches.
   */
  async cancelMatch(
    matchId: Uint8Array,
    playerOnePubkey: PublicKey,
    playerTwoPubkey: PublicKey,
    isSol: boolean
  ): Promise<string> {
    const caller = this.wallet.publicKey!;
    const [escrowPDA] = getEscrowPDA(matchId);
    const [vaultPDA] = getVaultPDA(matchId);
    const mint = USDC_MINT;

    const p1Ata = await getAssociatedTokenAddress(mint, playerOnePubkey);
    const p2Ata = await getAssociatedTokenAddress(mint, playerTwoPubkey);

    const tx = await (this.program.methods as any)
      .cancelMatch()
      .accounts({
        matchEscrow: escrowPDA,
        vault: vaultPDA,
        tokenMint: isSol ? SystemProgram.programId : mint,
        caller,
        playerOne: playerOnePubkey,
        playerTwo: playerTwoPubkey,
        playerOneAta: isSol ? playerOnePubkey : p1Ata,
        playerTwoAta: isSol ? playerTwoPubkey : p2Ata,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .transaction();

    return this.sendTx(tx);
  }

  /** Fetch on-chain match state */
  async fetchEscrow(matchId: Uint8Array) {
    const [escrowPDA] = getEscrowPDA(matchId);
    try {
      return await (this.program.account as any).matchEscrow.fetch(escrowPDA);
    } catch {
      return null;
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private async sendTx(tx: Transaction): Promise<string> {
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = this.wallet.publicKey!;

    const signed = await this.wallet.signTransaction!(tx);
    const raw = signed.serialize();
    const sig = await this.connection.sendRawTransaction(raw, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    await this.connection.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      'confirmed'
    );

    return sig;
  }
}

/** Explorer URL for a transaction */
export function explorerUrl(signature: string): string {
  const cluster = process.env.NEXT_PUBLIC_SOLANA_NETWORK === 'mainnet-beta'
    ? '' : '?cluster=devnet';
  return `https://explorer.solana.com/tx/${signature}${cluster}`;
}
