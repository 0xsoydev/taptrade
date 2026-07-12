import 'dotenv/config';
import { setupTxline } from '../src/txline/subscribe.js';
import type { Fixture } from '../src/txline/fixtures.js';

// ponytail: one-shot script to document what TxLINE data is and how we use it

async function main() {
  console.log('=== TxLINE API E2E ===\n');

  console.log('API: https://txline-dev.txodds.com/api');
  console.log('Provider: TxODDS / TxLINE');
  console.log('Network: Solana devnet');
  console.log('Competition: World Cup (competitionId=72)\n');

  const { axios } = await setupTxline();

  // 1. Fixtures
  console.log('--- 1. FIXTURES ---');
  const fixturesRes = await axios.get<Fixture[]>('/fixtures/snapshot', { params: { competitionId: 72 } });
  const fixtures = fixturesRes.data;
  console.log(`Found ${fixtures.length} World Cup fixture(s)\n`);

  if (fixtures.length === 0) {
    console.log('No fixtures available right now.');
    return;
  }

  const fixture = fixtures[0];
  console.log(`Example fixture:`);
  console.log(`  Match: ${fixture.Participant1} vs ${fixture.Participant2}`);
  console.log(`  FixtureId: ${fixture.FixtureId}`);
  console.log(`  StartTime: ${new Date(fixture.StartTime).toISOString()}`);
  console.log(`  Competition: ${fixture.Competition}\n`);

  // 2. Odds snapshot
  console.log('--- 2. ODDS SNAPSHOT ---');
  const oddsRes = await axios.get('/odds/snapshot/${fixture.FixtureId}'.replace('${fixture.FixtureId}', String(fixture.FixtureId)));
  const odds = oddsRes.data as any[];
  console.log(`Received ${odds.length} odds tick(s) for this fixture\n`);

  // 3. Explain each market type
  console.log('--- 3. WHAT THE DATA MEANS ---\n');
  console.log('TxLINE aggregates odds from 250+ bookmakers, removes the bookmaker margin');
  console.log('("vig"), and returns the consensus probability of each outcome.\n');

  for (const tick of odds.slice(0, 4)) {
    console.log(`Market: ${tick.SuperOddsType}`);
    if (tick.MarketParameters) console.log(`  Parameters: ${tick.MarketParameters}`);
    if (tick.MarketPeriod) console.log(`  Period: ${tick.MarketPeriod}`);

    const names = tick.PriceNames as string[];
    const pcts = tick.Pct as string[];

    names.forEach((name: string, i: number) => {
      const pct = pcts[i];
      const label = nameToOutcome(name, tick.SuperOddsType, fixture, i);
      console.log(`  ${label}: ${pct === 'NA' ? 'no data' : `${pct}%`}`);
    });
    console.log('');
  }

  // 4. Direct answer to the Spain vs Portugal question
  console.log('--- 4. IS THIS "WHO WILL WIN"? ---\n');
  console.log('No. It is NOT a prediction of who will win.');
  console.log('It is the market-implied probability: what the betting market thinks');
  console.log('the chance of each outcome is, based on money wagered by bettors.');
  console.log('If Spain vs Portugal shows Home 35% / Draw 30% / Away 35%, that means');
  console.log('the market prices Spain as a 35% chance to win, not a guarantee.\n');

  // 5. What we do with it
  console.log('--- 5. WHAT TAPTRADE DOES WITH THIS DATA ---\n');
  console.log('1. Normalize each odds payload into our odds_ticks table:');
  console.log('   matchId, marketType, pctHome, pctDraw, pctAway, ts\n');
  console.log('2. Stream ticks to the frontend via Socket.io\n');
  console.log('3. Render a live chart of probabilities (home/draw/away)\n');
  console.log('4. User taps a probability range square and bets USDC:');
  console.log('   "I think the home-win probability will enter 20-25% in the next 30s"\n');
  console.log('5. Keeper checks expired bets against the stored odds history');
  console.log('   and pays winners from the game wallet.\n');
}

function nameToOutcome(name: string, marketType: string, fixture: Fixture, index: number): string {
  if (marketType === '1X2_PARTICIPANT_RESULT') {
    if (name === 'part1') return `${fixture.Participant1} (home)`;
    if (name === 'part2') return `${fixture.Participant2} (away)`;
    return 'Draw';
  }
  if (marketType === 'OVERUNDER_PARTICIPANT_GOALS') {
    return name;
  }
  if (marketType === 'ASIANHANDICAP_PARTICIPANT_GOALS') {
    return name;
  }
  return `${name}[${index}]`;
}

main().catch((err) => {
  console.error('E2E failed:', err);
  process.exit(1);
});
