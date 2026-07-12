import { and, eq, gte, lt, lte } from 'drizzle-orm';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { db } from './db/index.js';
import { bets, oddsTicks, leaderboard } from './db/schema.js';

const connection = new Connection(process.env.ANCHOR_PROVIDER_URL ?? 'https://api.devnet.solana.com', 'confirmed');
const gameWallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.WALLET_SECRET_KEY!)));

const OUTCOME_FIELD = {
  home: 'pctHome',
  draw: 'pctDraw',
  away: 'pctAway',
} as const;

async function checkHit(bet: typeof bets.$inferSelect): Promise<boolean> {
  const field = OUTCOME_FIELD[bet.targetOutcome as keyof typeof OUTCOME_FIELD];

  const windowRows = await db.query.oddsTicks.findMany({
    where: and(
      eq(oddsTicks.matchId, bet.matchId),
      eq(oddsTicks.marketType, bet.marketType),
      gte(oddsTicks.ts, bet.windowStart),
      lte(oddsTicks.ts, bet.windowEnd)
    ),
    orderBy: (o, { asc }) => asc(o.ts),
  });

  let prevValue: number | null = null;
  for (const row of windowRows) {
    const value = row[field] as number | null;
    if (value != null) {
      if (value >= bet.minPct && value <= bet.maxPct) return true;
      if (prevValue != null) {
        const lo = Math.min(prevValue, value);
        const hi = Math.max(prevValue, value);
        if (hi >= bet.minPct && lo <= bet.maxPct) return true;
      }
      prevValue = value;
    }
  }
  return false;
}

export async function settleBets(): Promise<void> {
  const now = Date.now();
  const pending = await db.query.bets.findMany({
    where: and(eq(bets.status, 'open'), lt(bets.windowEnd, now)),
  });

  for (const bet of pending) {
    const hit = await checkHit(bet);

    // Mark the bet settled up front, regardless of payout outcome below: once a bet is past its
    // window it must never be picked up by `pending` again, or a payout failure (e.g. the game
    // wallet running low) would retry the same bet forever on every keeper tick.
    await db.update(bets).set({ status: hit ? 'won' : 'lost', settledAt: new Date() }).where(eq(bets.id, bet.id));
    await updateLeaderboard(bet.userWallet, bet.stakeLamports, hit ? bet.payoutLamports : 0, hit);

    if (hit) {
      try {
        await sendPayout(bet.userWallet, bet.payoutLamports);
      } catch (err) {
        console.error(`[keeper] payout failed for bet ${bet.id} (already marked won, will not retry):`, err);
      }
    }
  }
}

async function updateLeaderboard(wallet: string, stakeLamports: number, payoutLamports: number, won: boolean): Promise<void> {
  const existing = await db.query.leaderboard.findFirst({ where: eq(leaderboard.wallet, wallet) });
  if (existing) {
    await db.update(leaderboard).set({
      totalWagered: existing.totalWagered + stakeLamports,
      totalWon: existing.totalWon + payoutLamports,
      totalBets: existing.totalBets + 1,
      wins: existing.wins + (won ? 1 : 0),
    }).where(eq(leaderboard.wallet, wallet));
  } else {
    await db.insert(leaderboard).values({
      wallet,
      totalWagered: stakeLamports,
      totalWon: payoutLamports,
      totalBets: 1,
      wins: won ? 1 : 0,
    });
  }
}

async function sendPayout(walletAddress: string, amountLamports: number): Promise<void> {
  const recipient = new PublicKey(walletAddress);
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: gameWallet.publicKey, toPubkey: recipient, lamports: amountLamports })
  );
  await sendAndConfirmTransaction(connection, tx, [gameWallet]);
}

export function startKeeper(intervalMs = 5000): () => void {
  const id = setInterval(() => {
    settleBets().catch((err) => console.error('[keeper] error:', err));
  }, intervalMs);
  return () => clearInterval(id);
}
