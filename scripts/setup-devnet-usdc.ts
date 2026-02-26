/**
 * setup-devnet-usdc.ts
 * Creates a test USDC mint on devnet and mints tokens to your wallet.
 *
 * Run: ts-node scripts/setup-devnet-usdc.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getMint,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const DEVNET_RPC = 'https://api.devnet.solana.com';
const MINT_AMOUNT = 10_000; // 10,000 USDC
const USDC_DECIMALS = 6;

async function main() {
  const connection = new Connection(DEVNET_RPC, 'confirmed');

  // Load wallet from default Solana CLI path
  const walletPath = path.join(os.homedir(), '.config', 'solana', 'id.json');
  if (!fs.existsSync(walletPath)) {
    throw new Error(`Wallet not found at ${walletPath}. Run: solana-keygen new`);
  }
  const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  const payer = Keypair.fromSecretKey(new Uint8Array(secretKey));

  console.log('Wallet:', payer.publicKey.toBase58());

  // Airdrop if needed
  const balance = await connection.getBalance(payer.publicKey);
  if (balance < 0.5 * LAMPORTS_PER_SOL) {
    console.log('Requesting airdrop...');
    const sig = await connection.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig);
    console.log('Airdrop complete');
  }

  // Create USDC mint
  console.log('\nCreating USDC mint...');
  const mint = await createMint(
    connection,
    payer,
    payer.publicKey, // mint authority
    payer.publicKey, // freeze authority
    USDC_DECIMALS
  );
  console.log('✅ USDC Mint:', mint.toBase58());

  // Create ATA and mint tokens
  console.log('\nCreating associated token account...');
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    payer.publicKey
  );
  console.log('✅ ATA:', ata.address.toBase58());

  console.log(`\nMinting ${MINT_AMOUNT} USDC...`);
  const mintSig = await mintTo(
    connection,
    payer,
    mint,
    ata.address,
    payer,
    MINT_AMOUNT * Math.pow(10, USDC_DECIMALS)
  );
  console.log('✅ Minted! Tx:', mintSig);
  console.log(`   https://explorer.solana.com/tx/${mintSig}?cluster=devnet`);

  // Update .env.local
  const envPath = path.join(__dirname, '..', 'frontend', '.env.local');
  if (fs.existsSync(envPath)) {
    let env = fs.readFileSync(envPath, 'utf-8');
    env = env.replace(
      /NEXT_PUBLIC_USDC_MINT=.*/,
      `NEXT_PUBLIC_USDC_MINT=${mint.toBase58()}`
    );
    fs.writeFileSync(envPath, env);
    console.log('\n✅ Updated frontend/.env.local with new mint address');
  }

  console.log('\n════════════════════════════════════════');
  console.log('Setup complete! Add to frontend/.env.local:');
  console.log(`NEXT_PUBLIC_USDC_MINT=${mint.toBase58()}`);
  console.log('════════════════════════════════════════\n');
}

main().catch(console.error);
