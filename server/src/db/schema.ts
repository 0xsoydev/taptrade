import { pgTable, integer, bigint, text, real, boolean, timestamp, index, serial } from 'drizzle-orm/pg-core';

export const matches = pgTable('matches', {
  id: integer('id').primaryKey(),
  txlineFixtureId: integer('txline_fixture_id').notNull().unique(),
  homeTeam: text('home_team').notNull(),
  awayTeam: text('away_team').notNull(),
  competition: text('competition').notNull(),
  startTime: timestamp('start_time', { mode: 'date' }).notNull(),
  status: text('status').notNull().default('scheduled'),
  onchainEventSlug: text('onchain_event_slug'),
  onchainTokenIds: text('onchain_token_ids'),
});

export const oddsTicks = pgTable('odds_ticks', {
  id: serial('id').primaryKey(),
  matchId: integer('match_id').notNull(),
  marketType: text('market_type').notNull(),
  marketParams: text('market_params'),
  marketPeriod: text('market_period'),
  priceHome: integer('price_home').notNull(),
  priceDraw: integer('price_draw'),
  priceAway: integer('price_away').notNull(),
  pctHome: real('pct_home').notNull(),
  pctDraw: real('pct_draw'),
  pctAway: real('pct_away').notNull(),
  ts: bigint('ts', { mode: 'number' }).notNull(),
  inRunning: boolean('in_running').notNull().default(false),
}, (table) => ({
  oddsTicksMatchIdx: index('odds_ticks_match_idx').on(table.matchId, table.marketType, table.ts),
}));

export const bets = pgTable('bets', {
  id: serial('id').primaryKey(),
  userWallet: text('user_wallet').notNull(),
  matchId: integer('match_id').notNull(),
  marketType: text('market_type').notNull(),
  targetOutcome: text('target_outcome').notNull(),
  row: integer('row').notNull().default(0),
  minPct: real('min_pct').notNull(),
  maxPct: real('max_pct').notNull(),
  windowStart: bigint('window_start', { mode: 'number' }).notNull(),
  windowEnd: bigint('window_end', { mode: 'number' }).notNull(),
  stakeLamports: bigint('stake_lamports', { mode: 'number' }).notNull(),
  payoutLamports: bigint('payout_lamports', { mode: 'number' }).notNull(),
  actualPayoutLamports: bigint('actual_payout_lamports', { mode: 'number' }),
  status: text('status').notNull().default('open'),
  txSignature: text('tx_signature'),
  settledAt: timestamp('settled_at', { mode: 'date' }),
});

export const leaderboard = pgTable('leaderboard', {
  wallet: text('wallet').primaryKey(),
  totalWagered: bigint('total_wagered', { mode: 'number' }).notNull().default(0),
  totalWon: bigint('total_won', { mode: 'number' }).notNull().default(0),
  totalBets: integer('total_bets').notNull().default(0),
  wins: integer('wins').notNull().default(0),
});
