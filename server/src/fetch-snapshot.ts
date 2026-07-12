import 'dotenv/config';
import { setupTxline } from './txline/subscribe.js';
import { db } from './db/index.js';
import { oddsTicks } from './db/schema.js';
import { normalizeOdds } from './txline/stream.js';

async function main() {
  const { axios: client } = await setupTxline();
  const matches = await db.query.matches.findMany();

  for (const match of matches) {
    try {
      const res = await client.get(`/odds/snapshot/${match.txlineFixtureId}`);
      if (res.data) {
        const oddsList = Array.isArray(res.data) ? res.data : [res.data];
        for (const payload of oddsList) {
          if (payload.SuperOddsType === '1X2_PARTICIPANT_RESULT') {
            const tick = normalizeOdds(payload);
            if (tick) {
              tick.ts = Date.now(); // override with current time
              await db.insert(oddsTicks).values(tick);
            }
          }
        }
      }
    } catch (err: any) {
      console.error('Failed snapshot for', match.txlineFixtureId, err?.message);
    }
  }
  console.log('Fetched genuine starting snapshots for matches.');
  process.exit(0);
}

main().catch(console.error);
