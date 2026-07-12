CREATE TABLE `bets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_wallet` text NOT NULL,
	`match_id` integer NOT NULL,
	`market_type` text NOT NULL,
	`target_outcome` text NOT NULL,
	`min_pct` real NOT NULL,
	`max_pct` real NOT NULL,
	`window_start` integer NOT NULL,
	`window_end` integer NOT NULL,
	`stake_usdc` integer NOT NULL,
	`payout_usdc` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`tx_signature` text NOT NULL,
	`settled_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bets_tx_signature_unique` ON `bets` (`tx_signature`);--> statement-breakpoint
CREATE TABLE `leaderboard` (
	`wallet` text PRIMARY KEY NOT NULL,
	`total_wagered` integer DEFAULT 0 NOT NULL,
	`total_won` integer DEFAULT 0 NOT NULL,
	`total_bets` integer DEFAULT 0 NOT NULL,
	`wins` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `matches` (
	`id` integer PRIMARY KEY NOT NULL,
	`txline_fixture_id` integer NOT NULL,
	`home_team` text NOT NULL,
	`away_team` text NOT NULL,
	`competition` text NOT NULL,
	`start_time` integer NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `matches_txline_fixture_id_unique` ON `matches` (`txline_fixture_id`);--> statement-breakpoint
CREATE TABLE `odds_ticks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` integer NOT NULL,
	`market_type` text NOT NULL,
	`market_params` text,
	`market_period` text,
	`price_home` integer NOT NULL,
	`price_draw` integer,
	`price_away` integer NOT NULL,
	`pct_home` real NOT NULL,
	`pct_draw` real,
	`pct_away` real NOT NULL,
	`ts` integer NOT NULL,
	`in_running` integer DEFAULT false NOT NULL
);
