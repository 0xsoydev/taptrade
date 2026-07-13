import { and, eq, gte, lt, lte, isNull, or } from 'drizzle-orm';
import { Connection, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { db } from './db/index.js';
import { bets, oddsTicks, leaderboard } from './db/schema.js';
import { getTreasuryKeypair } from './wallet.js';

const connection = new Connection(process.env.ANCHOR_PROVIDER_URL ?? 'https://api.devnet.solana.com', 'confirmed');
const treasuryWallet = getTreasuryKeypair();

const OUTCOME_FIELD = {
  home: 'pctHome',
  draw: 'pctDraw',
  away: 'pctAway',
} as const;

// ponytail: exact tick only — no interpolation/crossing
async function checkHit(bet: typeof bets.$inferSelect): Promise<boolean> {
  const field = OUTCOME_FIELD[bet.targetOutcome as keyof typeof OUTCOME_FIELD];

  const ticks = await db.query.oddsTicks.findMany({
    where: and(
      eq(oddsTicks.matchId, bet.matchId),
      eq(oddsTicks.marketType, bet.marketType),
      gte(oddsTicks.ts, bet.windowStart),
      lte(oddsTicks.ts, bet.windowEnd),
    ),
  });

  for (const row of ticks) {
    const value = row[field] as number | null;
    if (value != null && value >= bet.minPct && value <= bet.maxPct) return true;
  }
  return false;
}

async function sendPayout(betId: number, walletAddress: string, amountLamports: number): Promise<boolean> {
  try {
    const recipient = new PublicKey(walletAddress);
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: treasuryWallet.publicKey, toPubkey: recipient, lamports: amountLamports }),
    );
    await sendAndConfirmTransaction(connection, tx, [treasuryWallet]);
    return true;
  } catch {
    return false;
  }
}

export async function settleBets(): Promise<void> {
  const now = Date.now();

  // 1. Expire open bets past their window
  const expired = await db.query.bets.findMany({
    where: and(eq(bets.status, 'open'), lt(bets.windowEnd, now)),
  });

  for (const bet of expired) {
    const hit = await checkHit(bet);
    if (hit) {
      // Mark won but don't settle payout yet — let the retry pass handle it
      await db.update(bets).set({ status: 'won' }).where(eq(bets.id, bet.id));
      await updateLeaderboard(bet.userWallet, bet.stakeLamports, bet.payoutLamports, true);
    } else {
      await db.update(bets).set({ status: 'lost', settledAt: new Date() }).where(eq(bets.id, bet.id));
      await updateLeaderboard(bet.userWallet, bet.stakeLamports, 0, false);
    }
  }

  // 2. Retry payouts for won bets without actualPayoutLamports
  const unpaid = await db.query.bets.findMany({
    where: and(eq(bets.status, 'won'), or(isNull(bets.actualPayoutLamports), eq(bets.actualPayoutLamports, 0))),
    limit: 5, // ponytail: small batch to avoid RPC spam
  });

  for (const bet of unpaid) {
    const sent = await sendPayout(bet.id, bet.userWallet, bet.payoutLamports);
    await db.update(bets).set({
      actualPayoutLamports: sent ? bet.payoutLamports : 0,
      settledAt: sent ? new Date() : bet.settledAt,
    }).where(eq(bets.id, bet.id));

    if (!sent) {
      console.error(`[keeper] payout retry failed for bet ${bet.id}, will retry next tick`);
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

export function startKeeper(intervalMs = 5000): () => void {
  const id = setInterval(() => {
    settleBets().catch((err) => console.error('[keeper] error:', err));
  }, intervalMs);
  return () => clearInterval(id);
}
