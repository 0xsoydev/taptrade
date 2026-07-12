import 'dotenv/config';
import { setupTxline } from '../src/txline/subscribe.js';
import { EventSource } from 'eventsource';
import { TXLINE_API_BASE_URL } from '../src/txline/config.js';

async function main() {
  const { apiToken, jwt } = await setupTxline();
  console.log('[probe] subscribed to TxLINE');

  const url = `${TXLINE_API_BASE_URL}/odds/stream`;
  const es = new EventSource(url, {
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        headers: {
          ...init?.headers,
          Authorization: `Bearer ${jwt}`,
          'X-Api-Token': apiToken,
          'Accept-Encoding': 'deflate',
        },
      }),
  });

  const byFixture: Record<number, number> = {};
  const byMarket: Record<string, number> = {};
  let total = 0;
  let heartbeats = 0;
  let odds = 0;

  es.onmessage = (e) => {
    total++;
    const data = JSON.parse(e.data);
    if (data.SuperOddsType) {
      odds++;
      byFixture[data.FixtureId] = (byFixture[data.FixtureId] || 0) + 1;
      byMarket[data.SuperOddsType] = (byMarket[data.SuperOddsType] || 0) + 1;
      console.log(`  [odds] fixture=${data.FixtureId} market=${data.SuperOddsType} period=${data.MarketPeriod || 'full'} home=${data.Pct?.[0]}%`);
    } else {
      heartbeats++;
    }
  };

  es.onerror = (err) => console.error('[probe] SSE error:', err);

  await new Promise((resolve) => setTimeout(resolve, 60000));
  es.close();

  console.log('\n=== 60s PROBE RESULTS ===');
  console.log(`Total messages: ${total}`);
  console.log(`Heartbeats: ${heartbeats}`);
  console.log(`Odds ticks: ${odds}`);
  if (odds > 0) {
    console.log(`By fixture:`, byFixture);
    console.log(`By market:`, byMarket);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('[probe] fatal:', e);
  process.exit(1);
});
