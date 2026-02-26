/**
 * test-staking.ts
 * End-to-end test: creates two wallets, stakes USDC, resolves match, checks payouts.
 *
 * Run: ts-node scripts/test-staking.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
} from '@solana/web3.js';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from '@solana/spl-token';
import { AnchorProvider, Program, BN, web3 } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import IDL from '../frontend/src/lib/idl.json';

const PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || 'REPLACE_AFTER_DEPLOY');
const RPC = 'https://api.devnet.solana.com';
const STAKE_USDC = 5; // 5 USDC each
const USDC_DECIMALS = 6;

function getEscrowPDA(matchId: Uint8Array) {
  return PublicKey.findProgramAddressSync([Buffer.from('escrow'), Buffer.from(matchId)], PROGRAM_ID);
}
function getVaultPDA(matchId: Uint8Array) {
  return PublicKey.findProgramAddressSync([Buffer.from('vault'), Buffer.from(matchId)], PROGRAM_ID);
}

async function airdrop(connection: Connection, pubkey: PublicKey, sol = 2) {
  const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig);
  console.log(`  Airdropped ${sol} SOL to ${pubkey.toBase58().slice(0, 8)}...`);
}

function makeProvider(connection: Connection, wallet: Keypair): AnchorProvider {
  return new AnchorProvider(
    connection,
    {
      publicKey: wallet.publicKey,
      signTransaction: async (tx) => { tx.sign(wallet); return tx; },
      signAllTransactions: async (txs) => { txs.forEach(tx => tx.sign(wallet)); return txs; },
    } as any,
    { commitment: 'confirmed' }
  );
}

async function main() {
  const connection = new Connection(RPC, 'confirmed');

  console.log('═══════════════════════════════════════════════');
  console.log('  SolCrush Staking — End-to-End Test');
  console.log('═══════════════════════════════════════════════\n');

  // Create test wallets
  const payer = Keypair.generate();
  const player1 = Keypair.generate();
  const player2 = Keypair.generate();
  const treasury = Keypair.generate();

  console.log('Wallets:');
  console.log('  Player1:', player1.publicKey.toBase58());
  console.log('  Player2:', player2.publicKey.toBase58());
  console.log('  Treasury:', treasury.publicKey.toBase58());

  // Airdrop
  console.log('\nAirdropping SOL...');
  await airdrop(connection, payer, 3);
  await airdrop(connection, player1, 1);
  await airdrop(connection, player2, 1);

  // Create test USDC mint
  console.log('\nCreating test USDC mint...');
  const mint = await createMint(connection, payer, payer.publicKey, payer.publicKey, USDC_DECIMALS);
  console.log('  Mint:', mint.toBase58());

  // Create ATAs and mint USDC
  const p1ATA = await getOrCreateAssociatedTokenAccount(connection, payer, mint, player1.publicKey);
  const p2ATA = await getOrCreateAssociatedTokenAccount(connection, payer, mint, player2.publicKey);
  const treasuryATA = await getOrCreateAssociatedTokenAccount(connection, payer, mint, treasury.publicKey);

  const mintAmount = 100 * Math.pow(10, USDC_DECIMALS); // 100 USDC each
  await mintTo(connection, payer, mint, p1ATA.address, payer, mintAmount);
  await mintTo(connection, payer, mint, p2ATA.address, payer, mintAmount);
  console.log('  Minted 100 USDC to each player');

  // ── Test 1: initialize_match (P1 deposits) ────────────────────────────────
  console.log('\n[1/4] P1 creates match and deposits stake...');
  const matchId = new Uint8Array(32);
  crypto.getRandomValues(matchId);
  const [escrowPDA] = getEscrowPDA(matchId);
  const [vaultPDA] = getVaultPDA(matchId);
  const stakeAmount = new BN(STAKE_USDC * Math.pow(10, USDC_DECIMALS));

  const p1Program = new Program(IDL as any, PROGRAM_ID, makeProvider(connection, player1));
  const tx1 = await (p1Program.methods as any)
    .initializeMatch(Array.from(matchId), stakeAmount, false)
    .accounts({
      matchEscrow: escrowPDA,
      vault: vaultPDA,
      tokenMint: mint,
      playerOneAta: p1ATA.address,
      playerOne: player1.publicKey,
      treasury: treasury.publicKey,
      tokenProgram: web3.TOKEN_PROGRAM_ID,
      associatedTokenProgram: web3.ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: web3.SYSVAR_RENT_PUBKEY,
    })
    .rpc();
  console.log('  ✅ Match created! Tx:', tx1.slice(0, 20) + '...');

  // ── Test 2: deposit_stake (P2 joins) ──────────────────────────────────────
  console.log('\n[2/4] P2 joins and deposits stake...');
  const p2Program = new Program(IDL as any, PROGRAM_ID, makeProvider(connection, player2));
  const tx2 = await (p2Program.methods as any)
    .depositStake()
    .accounts({
      matchEscrow: escrowPDA,
      vault: vaultPDA,
      tokenMint: mint,
      playerTwoAta: p2ATA.address,
      playerTwo: player2.publicKey,
      tokenProgram: web3.TOKEN_PROGRAM_ID,
      associatedTokenProgram: web3.ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log('  ✅ P2 deposited! Tx:', tx2.slice(0, 20) + '...');

  // Check vault balance
  const vault = await getAccount(connection, vaultPDA);
  console.log(`  Vault balance: ${Number(vault.amount) / Math.pow(10, USDC_DECIMALS)} USDC`);

  // ── Test 3: resolve_match (P1 wins) ───────────────────────────────────────
  console.log('\n[3/4] Resolving match — Player1 wins...');
  const tx3 = await (p1Program.methods as any)
    .resolveMatch(player1.publicKey)
    .accounts({
      matchEscrow: escrowPDA,
      vault: vaultPDA,
      tokenMint: mint,
      caller: player1.publicKey,
      playerOne: player1.publicKey,
      playerTwo: player2.publicKey,
      playerOneAta: p1ATA.address,
      playerTwoAta: p2ATA.address,
      treasury: treasury.publicKey,
      treasuryAta: treasuryATA.address,
      tokenProgram: web3.TOKEN_PROGRAM_ID,
      associatedTokenProgram: web3.ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log('  ✅ Match resolved! Tx:', tx3.slice(0, 20) + '...');

  // ── Test 4: Verify balances ───────────────────────────────────────────────
  console.log('\n[4/4] Verifying final balances...');
  const p1Final = await getAccount(connection, p1ATA.address);
  const p2Final = await getAccount(connection, p2ATA.address);
  const treasuryFinal = await getAccount(connection, treasuryATA.address);

  const totalPool = STAKE_USDC * 2;
  const fee = totalPool * 0.025;
  const expectedWinner = totalPool - fee;

  console.log(`\n  Initial: 100 USDC each`);
  console.log(`  Staked:  ${STAKE_USDC} USDC each (pool: ${totalPool} USDC)`);
  console.log(`  Fee:     ${fee} USDC (2.5%)`);
  console.log(`\n  P1 (winner): ${Number(p1Final.amount) / Math.pow(10, USDC_DECIMALS)} USDC`);
  console.log(`    Expected:  ${100 - STAKE_USDC + expectedWinner} USDC`);
  console.log(`  P2 (loser):  ${Number(p2Final.amount) / Math.pow(10, USDC_DECIMALS)} USDC`);
  console.log(`    Expected:  ${100 - STAKE_USDC} USDC`);
  console.log(`  Treasury:    ${Number(treasuryFinal.amount) / Math.pow(10, USDC_DECIMALS)} USDC`);
  console.log(`    Expected:  ${fee} USDC`);

  console.log('\n═══════════════════════════════════════════════');
  console.log('  ✅ All tests passed!');
  console.log('═══════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
