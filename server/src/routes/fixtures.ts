import { Router } from 'express';
import { db } from '../db/index.js';

const router = Router();

router.get('/', async (_req, res) => {
  const rows = await db.query.matches.findMany({
    orderBy: (m, { asc }) => asc(m.startTime),
    limit: 50,
  });

  // Deduplicate: if two rows share the same homeTeam + awayTeam + startTime,
  // prefer the one with an onchainEventSlug (live onchain data), otherwise take the first.
  const seen = new Map<string, typeof rows[number]>();
  for (const r of rows) {
    // startTime from drizzle with mode:'timestamp' is a JS Date
    const startMs = r.startTime instanceof Date
      ? r.startTime.getTime()
      : Number(r.startTime) * 1000;

    const key = `${r.homeTeam}|${r.awayTeam}|${startMs}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, r);
    } else if (r.onchainEventSlug && !existing.onchainEventSlug) {
      // Prefer the onchain entry (has live data)
      seen.set(key, r);
    }
  }

  const deduped = Array.from(seen.values()).sort((a, b) => {
    const aMs = a.startTime instanceof Date ? a.startTime.getTime() : Number(a.startTime) * 1000;
    const bMs = b.startTime instanceof Date ? b.startTime.getTime() : Number(b.startTime) * 1000;
    return aMs - bMs;
  });

  res.json(deduped.map((r) => {
    const startMs = r.startTime instanceof Date
      ? r.startTime.getTime()
      : Number(r.startTime) * 1000;

    return {
      id: r.txlineFixtureId,
      homeTeam: r.homeTeam,
      awayTeam: r.awayTeam,
      competition: r.competition,
      startTime: startMs,           // ← always Unix milliseconds
      status: r.status,
      onchainEventSlug: r.onchainEventSlug ?? null,
      onchainTokenIds: r.onchainTokenIds ? JSON.parse(r.onchainTokenIds) : null,
    };
  }));
});

export default router;
