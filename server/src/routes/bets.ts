import { Router } from 'express';
import { Connection, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { z } from 'zod';
import { db } from '../db/index.js';
import { bets, leaderboard } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { deriveAbstractedKeypair, getTreasuryKeypair, DEFAULT_STAKE_LAMPORTS } from '../wallet.js';

const connection = new Connection(process.env.ANCHOR_PROVIDER_URL ?? 'https://api.devnet.solana.com', 'confirmed');
const treasuryWallet = getTreasuryKeypair();

const postBetSchema = z.object({
  externalWallet: z.string(),
  matchId: z.number(),
  marketType: z.string(),
  targetOutcome: z.enum(['home', 'draw', 'away']),
  row: z.number(),
  minPct: z.number(),
  maxPct: z.number(),
  windowStart: z.number(),
  windowEnd: z.number(),
  multiplier: z.number(),
});

const router = Router();

router.post('/', async (req, res) => {
  const parsed = postBetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.format() });
    return;
  }

  const data = parsed.data;

  // ponytail: derive abstracted wallet from external pubkey
  const abstracted = deriveAbstractedKeypair(data.externalWallet);
  const abstractedAddr = abstracted.publicKey.toBase58();

  // Check balance: need stake + rent-exempt minimum (0.00089 SOL) + fee (5000 lamports)
  const balance = await connection.getBalance(abstracted.publicKey);
  const minRequired = DEFAULT_STAKE_LAMPORTS + 890880 + 5000;
  if (balance < minRequired) {
    res.status(400).json({ error: 'insufficient balance', balance, minRequired });
    return;
  }

  // Server signs: abstracted wallet → treasury
  const stakeLamports = DEFAULT_STAKE_LAMPORTS;
  const payoutLamports = Math.round(stakeLamports * data.multiplier);

  try {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: abstracted.publicKey,
        toPubkey: treasuryWallet.publicKey,
        lamports: stakeLamports,
      }),
    );
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = abstracted.publicKey;
    tx.partialSign(abstracted);

    // Fee is paid by abstracted wallet (deducted from stake amount)
    const raw = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await connection.confirmTransaction({ signature: raw, blockhash, lastValidBlockHeight }, 'confirmed');

    const [bet] = await db.insert(bets).values({
      userWallet: data.externalWallet,
      matchId: data.matchId,
      marketType: data.marketType,
      targetOutcome: data.targetOutcome,
      row: data.row,
      minPct: data.minPct,
      maxPct: data.maxPct,
      windowStart: data.windowStart,
      windowEnd: data.windowEnd,
      stakeLamports,
      payoutLamports,
      status: 'open',
      txSignature: raw,
    }).returning();

    res.json(bet);
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'bet failed' });
  }
});

router.get('/leaderboard', async (_req, res) => {
  const rows = await db.query.leaderboard.findMany({
    orderBy: (lb, { desc: d }) => d(lb.totalWon),
    limit: 20,
  });
  res.json(rows);
});

router.get('/:wallet', async (req, res) => {
  const rows = await db.query.bets.findMany({
    where: eq(bets.userWallet, req.params.wallet),
    orderBy: (b, { desc }) => desc(b.id),
    limit: 50,
  });
  res.json(rows);
});

export default router;
