/**
 * solcrushChain.ts
 * On-chain staking client for SolCrush
 */

import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  createSyncNativeInstruction,
  createCloseAccountInstruction,
} from '@solana/spl-token';
import { Program, AnchorProvider, BN, web3 } from '@coral-xyz/anchor';
import { WalletContextState } from '@solana/wallet-adapter-react';
import IDL from './idl.json';

// ─── Constants ───────────────────────────────────────────────────────────────

// Hardcoded — don't rely on env var which can be undefined at runtime
export const PROGRAM_ID = new PublicKey('7LLvnnLaqME25Kuf7Q6nUgFrrKKSWxUNdC62fFV21eZs');
export const TREASURY   = new PublicKey('5o65W1kooL1Tb9ZBKPu9BABQ79fo7x8st7X9V4TDJjZC');

// Devnet USDC
export const USDC_MINT  = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

// Wrapped SOL mint (So111...112) — used for SOL matches via SPL token
export const WSOL_MINT  = NATIVE_MINT;

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

export function generateMatchId(): Uint8Array {
  const id = new Uint8Array(32);
  crypto.getRandomValues(id);
  return id;
}

export function matchIdToHex(id: Uint8Array): string {
  return Array.from(id).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function toChainAmount(amount: number, isSol: boolean): BN {
  return new BN(Math.floor(amount * (isSol ? LAMPORTS_PER_SOL : Math.pow(10, USDC_DECIMALS))));
}

export function fromChainAmount(amount: BN, isSol: boolean): number {
  return amount.toNumber() / (isSol ? LAMPORTS_PER_SOL : Math.pow(10, USDC_DECIMALS));
}

export function explorerUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

function getProgram(wallet: WalletContextState, connection: Connection): Program {
  const provider = new AnchorProvider(connection, wallet as any, {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });
  return new Program(IDL as any, PROGRAM_ID, provider);
}

// ─── ATA helper ──────────────────────────────────────────────────────────────

async function getOrCreateATA(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
  payer: PublicKey
): Promise<{ ata: PublicKey; createIx: web3.TransactionInstruction | null }> {
  const ata = await getAssociatedTokenAddress(mint, owner, false);
  const info = await connection.getAccountInfo(ata);
  return {
    ata,
    createIx: info ? null : createAssociatedTokenAccountInstruction(payer, ata, owner, mint),
  };
}

// ─── Main client ─────────────────────────────────────────────────────────────

export class SolCrushChain {
  private program: Program;
  private connection: Connection;
  private wallet: WalletContextState;

  constructor(wallet: WalletContextState, connection: Connection) {
    this.wallet  = wallet;
    this.connection = connection;
    this.program = getProgram(wallet, connection);
  }

  // ── Create match (P1 deposits stake) ───────────────────────────────────────
  async createMatch(
    stakeAmount: number,
    isSol: boolean
  ): Promise<{ matchId: Uint8Array; escrowPDA: PublicKey; signature: string }> {
    const playerOne = this.wallet.publicKey!;
    const matchId   = generateMatchId();
    const [escrowPDA] = getEscrowPDA(matchId);
    const [vaultPDA]  = getVaultPDA(matchId);
    const chainAmount = toChainAmount(stakeAmount, isSol);
    const mint = isSol ? WSOL_MINT : USDC_MINT;

    const tx = new Transaction();

    if (isSol) {
      // For SOL: wrap SOL into a temp wSOL ATA, then program transfers from it
      const wsolAta = await getAssociatedTokenAddress(WSOL_MINT, playerOne);
      const wsolInfo = await this.connection.getAccountInfo(wsolAta);

      // Create wSOL ATA if needed
      if (!wsolInfo) {
        tx.add(createAssociatedTokenAccountInstruction(playerOne, wsolAta, playerOne, WSOL_MINT));
      }

      // Transfer SOL to wSOL ATA and sync
      tx.add(
        SystemProgram.transfer({ fromPubkey: playerOne, toPubkey: wsolAta, lamports: chainAmount.toNumber() }),
        createSyncNativeInstruction(wsolAta)
      );

      const ix = await (this.program.methods as any)
        .initializeMatch(Array.from(matchId), chainAmount, true)
        .accounts({
          matchEscrow:            escrowPDA,
          vault:                  vaultPDA,
          tokenMint:              WSOL_MINT,
          playerOneAta:           wsolAta,
          playerOne,
          treasury:               TREASURY,
          tokenProgram:           TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram:          SystemProgram.programId,
          rent:                   web3.SYSVAR_RENT_PUBKEY,
        })
        .instruction();

      tx.add(ix);
    } else {
      // USDC path
      const { ata: playerOneAta, createIx } = await getOrCreateATA(
        this.connection, USDC_MINT, playerOne, playerOne
      );
      if (createIx) tx.add(createIx);

      const ix = await (this.program.methods as any)
        .initializeMatch(Array.from(matchId), chainAmount, false)
        .accounts({
          matchEscrow:            escrowPDA,
          vault:                  vaultPDA,
          tokenMint:              USDC_MINT,
          playerOneAta,
          playerOne,
          treasury:               TREASURY,
          tokenProgram:           TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram:          SystemProgram.programId,
          rent:                   web3.SYSVAR_RENT_PUBKEY,
        })
        .instruction();

      tx.add(ix);
    }

    const signature = await this.sendTx(tx);
    return { matchId, escrowPDA, signature };
  }

  // ── Deposit stake (P2 joins) ────────────────────────────────────────────────
  async depositStake(matchId: Uint8Array, isSol: boolean): Promise<string> {
    const playerTwo = this.wallet.publicKey!;
    const [escrowPDA] = getEscrowPDA(matchId);
    const [vaultPDA]  = getVaultPDA(matchId);
    const mint = isSol ? WSOL_MINT : USDC_MINT;

    const tx = new Transaction();

    if (isSol) {
      // Fetch escrow to get stake amount
      const escrow = await (this.program.account as any).matchEscrow.fetch(escrowPDA);
      const lamports = escrow.stakeAmount.toNumber();
      const wsolAta = await getAssociatedTokenAddress(WSOL_MINT, playerTwo);
      const wsolInfo = await this.connection.getAccountInfo(wsolAta);

      if (!wsolInfo) {
        tx.add(createAssociatedTokenAccountInstruction(playerTwo, wsolAta, playerTwo, WSOL_MINT));
      }

      tx.add(
        SystemProgram.transfer({ fromPubkey: playerTwo, toPubkey: wsolAta, lamports }),
        createSyncNativeInstruction(wsolAta)
      );

      const ix = await (this.program.methods as any)
        .depositStake()
        .accounts({
          matchEscrow:            escrowPDA,
          vault:                  vaultPDA,
          tokenMint:              WSOL_MINT,
          playerTwoAta:           wsolAta,
          playerTwo,
          tokenProgram:           TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram:          SystemProgram.programId,
        })
        .instruction();

      tx.add(ix);
    } else {
      const { ata: playerTwoAta, createIx } = await getOrCreateATA(
        this.connection, USDC_MINT, playerTwo, playerTwo
      );
      if (createIx) tx.add(createIx);

      const ix = await (this.program.methods as any)
        .depositStake()
        .accounts({
          matchEscrow:            escrowPDA,
          vault:                  vaultPDA,
          tokenMint:              USDC_MINT,
          playerTwoAta,
          playerTwo,
          tokenProgram:           TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram:          SystemProgram.programId,
        })
        .instruction();

      tx.add(ix);
    }

    return this.sendTx(tx);
  }

  // ── Resolve match (pay winner) ──────────────────────────────────────────────
  async resolveMatch(
    matchId: Uint8Array,
    playerOnePubkey: PublicKey,
    playerTwoPubkey: PublicKey,
    isSol: boolean,
    winner: PublicKey
  ): Promise<string> {
    const caller      = this.wallet.publicKey!;
    const [escrowPDA] = getEscrowPDA(matchId);
    const [vaultPDA]  = getVaultPDA(matchId);
    const mint        = isSol ? WSOL_MINT : USDC_MINT;

    const p1Ata      = await getAssociatedTokenAddress(mint, playerOnePubkey);
    const p2Ata      = await getAssociatedTokenAddress(mint, playerTwoPubkey);
    const treasAta   = await getAssociatedTokenAddress(mint, TREASURY);

    const tx = new Transaction();

    // Create treasury ATA if it doesn't exist
    const treasInfo = await this.connection.getAccountInfo(treasAta);
    if (!treasInfo) {
      tx.add(createAssociatedTokenAccountInstruction(caller, treasAta, TREASURY, mint));
    }

    const ix = await (this.program.methods as any)
      .resolveMatch(winner)
      .accounts({
        matchEscrow:            escrowPDA,
        vault:                  vaultPDA,
        tokenMint:              mint,
        caller,
        playerOne:              playerOnePubkey,
        playerTwo:              playerTwoPubkey,
        playerOneAta:           p1Ata,
        playerTwoAta:           p2Ata,
        treasury:               TREASURY,
        treasuryAta:            treasAta,
        tokenProgram:           TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram:          SystemProgram.programId,
      })
      .instruction();

    tx.add(ix);
    return this.sendTx(tx);
  }

  // ── Cancel match (refund) ───────────────────────────────────────────────────
  async cancelMatch(
    matchId: Uint8Array,
    playerOnePubkey: PublicKey,
    playerTwoPubkey: PublicKey,
    isSol: boolean
  ): Promise<string> {
    const caller      = this.wallet.publicKey!;
    const [escrowPDA] = getEscrowPDA(matchId);
    const [vaultPDA]  = getVaultPDA(matchId);
    const mint        = isSol ? WSOL_MINT : USDC_MINT;

    const p1Ata = await getAssociatedTokenAddress(mint, playerOnePubkey);
    const p2Ata = await getAssociatedTokenAddress(mint, playerTwoPubkey);

    const tx = await (this.program.methods as any)
      .cancelMatch()
      .accounts({
        matchEscrow:            escrowPDA,
        vault:                  vaultPDA,
        tokenMint:              mint,
        caller,
        playerOne:              playerOnePubkey,
        playerTwo:              playerTwoPubkey,
        playerOneAta:           p1Ata,
        playerTwoAta:           p2Ata,
        tokenProgram:           TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram:          SystemProgram.programId,
      })
      .transaction();

    return this.sendTx(tx);
  }

  // ── Fetch match state ───────────────────────────────────────────────────────
  async fetchEscrow(matchId: Uint8Array) {
    const [escrowPDA] = getEscrowPDA(matchId);
    try {
      return await (this.program.account as any).matchEscrow.fetch(escrowPDA);
    } catch {
      return null;
    }
  }

  // ── Send transaction ────────────────────────────────────────────────────────
  private async sendTx(tx: Transaction): Promise<string> {
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash('confirmed');

    tx.recentBlockhash = blockhash;
    tx.feePayer        = this.wallet.publicKey!;

    const signed = await this.wallet.signTransaction!(tx);
    const sig    = await this.connection.sendRawTransaction(signed.serialize(), {
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
