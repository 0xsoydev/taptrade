import { Router } from 'express';
import { Connection, PublicKey } from '@solana/web3.js';
import { z } from 'zod';
import { db } from '../db/index.js';
import { bets, leaderboard } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';

const connection = new Connection(process.env.ANCHOR_PROVIDER_URL ?? 'https://api.devnet.solana.com', 'confirmed');
const gameWallet = new PublicKey(process.env.GAME_WALLET_ADDRESS!);

const postBetSchema = z.object({
  userWallet: z.string(),
  matchId: z.number(),
  marketType: z.string(),
  targetOutcome: z.enum(['home', 'draw', 'away']),
  row: z.number(),
  minPct: z.number(),
  maxPct: z.number(),
  windowStart: z.number(),
  windowEnd: z.number(),
  stakeLamports: z.number(),
  payoutLamports: z.number(),
  txSignature: z.string(),
});

async function verifySolTransfer(signature: string, expectedFrom: string, expectedAmountLamports: number): Promise<boolean> {
  const tx = await connection.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  if (!tx?.meta) return false;

  const accountKeys = tx.transaction.message.accountKeys;
  const gameIndex = accountKeys.findIndex((k) => k.pubkey.equals(gameWallet));
  const senderIndex = accountKeys.findIndex((k) => k.pubkey.toBase58() === expectedFrom);
  if (gameIndex === -1 || senderIndex === -1) return false;

  const gameDiff = tx.meta.postBalances[gameIndex] - tx.meta.preBalances[gameIndex];
  if (gameDiff !== expectedAmountLamports) return false;

  // sender is the fee payer, so their balance drops by at least the transferred amount (plus fee)
  const senderDiff = tx.meta.preBalances[senderIndex] - tx.meta.postBalances[senderIndex];
  return senderDiff >= expectedAmountLamports;
}

const router = Router();

router.post('/', async (req, res) => {
  const parsed = postBetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.format() });
    return;
  }

  const data = parsed.data;
  const existing = await db.query.bets.findFirst({ where: eq(bets.txSignature, data.txSignature) });
  if (existing) {
    res.status(409).json({ error: 'duplicate bet' });
    return;
  }

  const valid = await verifySolTransfer(data.txSignature, data.userWallet, data.stakeLamports);
  if (!valid) {
    res.status(400).json({ error: 'invalid transfer' });
    return;
  }

  const [bet] = await db.insert(bets).values(data).returning();
  res.json(bet);
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
