CREATE TABLE "bets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_wallet" text NOT NULL,
	"match_id" integer NOT NULL,
	"market_type" text NOT NULL,
	"target_outcome" text NOT NULL,
	"row" integer DEFAULT 0 NOT NULL,
	"min_pct" real NOT NULL,
	"max_pct" real NOT NULL,
	"window_start" bigint NOT NULL,
	"window_end" bigint NOT NULL,
	"stake_lamports" bigint NOT NULL,
	"payout_lamports" bigint NOT NULL,
	"actual_payout_lamports" bigint,
	"status" text DEFAULT 'open' NOT NULL,
	"tx_signature" text,
	"settled_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "leaderboard" (
	"wallet" text PRIMARY KEY NOT NULL,
	"total_wagered" bigint DEFAULT 0 NOT NULL,
	"total_won" bigint DEFAULT 0 NOT NULL,
	"total_bets" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" integer PRIMARY KEY NOT NULL,
	"txline_fixture_id" integer NOT NULL,
	"home_team" text NOT NULL,
	"away_team" text NOT NULL,
	"competition" text NOT NULL,
	"start_time" timestamp NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"onchain_event_slug" text,
	"onchain_token_ids" text,
	CONSTRAINT "matches_txline_fixture_id_unique" UNIQUE("txline_fixture_id")
);
--> statement-breakpoint
CREATE TABLE "odds_ticks" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" integer NOT NULL,
	"market_type" text NOT NULL,
	"market_params" text,
	"market_period" text,
	"price_home" integer NOT NULL,
	"price_draw" integer,
	"price_away" integer NOT NULL,
	"pct_home" real NOT NULL,
	"pct_draw" real,
	"pct_away" real NOT NULL,
	"ts" bigint NOT NULL,
	"in_running" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX "odds_ticks_match_idx" ON "odds_ticks" USING btree ("match_id","market_type","ts");