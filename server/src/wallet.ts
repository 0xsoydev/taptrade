import { createHmac } from 'crypto';
import { Keypair } from '@solana/web3.js';

// ponytail: deterministic HD derivation, no storage needed
const MASTER_SEED = process.env.ABSTRACTED_WALLET_MASTER_SEED ?? '';

export function deriveAbstractedKeypair(externalWalletPubkey: string): Keypair {
  if (!MASTER_SEED) throw new Error('ABSTRACTED_WALLET_MASTER_SEED not set');
  const hmac = createHmac('sha512', MASTER_SEED).update(externalWalletPubkey).digest();
  return Keypair.fromSeed(hmac.subarray(0, 32));
}

export function getTreasuryKeypair(): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.WALLET_SECRET_KEY!)));
}

export const DEFAULT_STAKE_LAMPORTS = 1_000_000; // 0.001 SOL
