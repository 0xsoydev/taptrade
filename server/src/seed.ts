import { db } from './db/index.js';
import { oddsTicks, matches } from './db/schema.js';

async function main() {
  const allMatches = await db.query.matches.findMany();
  for (const match of allMatches) {
    const ticks = [];
    const now = Date.now();
    
    // start probabilities
    let pctHome = 40 + (Math.random() - 0.5) * 10;
    let pctAway = 35 + (Math.random() - 0.5) * 10;
    
    for (let i = 100; i >= 0; i--) {
      // random walk
      pctHome = Math.max(5, Math.min(95, pctHome + (Math.random() - 0.5) * 2));
      pctAway = Math.max(5, Math.min(95 - pctHome, pctAway + (Math.random() - 0.5) * 2));
      const pctDraw = 100 - pctHome - pctAway;
      
      ticks.push({
        matchId: match.txlineFixtureId,
        marketType: '1X2_PARTICIPANT_RESULT',
        marketParams: null,
        marketPeriod: null,
        priceHome: 10000 / pctHome,
        priceDraw: 10000 / pctDraw,
        priceAway: 10000 / pctAway,
        pctHome: pctHome,
        pctDraw: pctDraw,
        pctAway: pctAway,
        ts: now - i * 60000, // 1 minute intervals
        inRunning: true,
      });
    }
    await db.insert(oddsTicks).values(ticks);
  }
  console.log('Seeded mock historical odds for', allMatches.length, 'matches');
  process.exit(0);
}

main().catch(console.error);
