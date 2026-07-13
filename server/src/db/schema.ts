import { sqliteTable, integer, text, real } from 'drizzle-orm/sqlite-core';

export const matches = sqliteTable('matches', {
  id: integer('id').primaryKey(),
  txlineFixtureId: integer('txline_fixture_id').notNull().unique(),
  homeTeam: text('home_team').notNull(),
  awayTeam: text('away_team').notNull(),
  competition: text('competition').notNull(),
  startTime: integer('start_time', { mode: 'timestamp' }).notNull(),
  status: text('status').notNull().default('scheduled'),
  onchainEventSlug: text('onchain_event_slug'),
  onchainTokenIds: text('onchain_token_ids'),
});

export const oddsTicks = sqliteTable('odds_ticks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
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
  ts: integer('ts').notNull(),
  inRunning: integer('in_running', { mode: 'boolean' }).notNull().default(false),
});

export const bets = sqliteTable('bets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userWallet: text('user_wallet').notNull(), // external wallet pubkey
  matchId: integer('match_id').notNull(),
  marketType: text('market_type').notNull(),
  targetOutcome: text('target_outcome').notNull(), // home / draw / away
  row: integer('row').notNull().default(0),
  minPct: real('min_pct').notNull(),
  maxPct: real('max_pct').notNull(),
  windowStart: integer('window_start').notNull(),
  windowEnd: integer('window_end').notNull(),
  stakeLamports: integer('stake_lamports').notNull(),
  payoutLamports: integer('payout_lamports').notNull(),
  actualPayoutLamports: integer('actual_payout_lamports'), // ponytail: null = not yet paid, retry on keeper tick
  status: text('status').notNull().default('open'), // open / won / lost
  txSignature: text('tx_signature'),
  settledAt: integer('settled_at', { mode: 'timestamp' }),
});

export const leaderboard = sqliteTable('leaderboard', {
  wallet: text('wallet').primaryKey(),
  totalWagered: integer('total_wagered').notNull().default(0),
  totalWon: integer('total_won').notNull().default(0),
  totalBets: integer('total_bets').notNull().default(0),
  wins: integer('wins').notNull().default(0),
});
