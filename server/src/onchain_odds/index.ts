import { db } from '../db/index.js';
import { matches } from '../db/schema.js';
import { searchWorldCupMatches, getEventBySlug, type TokenMap } from './resolver.js';
import { startOnchainStream, type OddsBroadcast } from './stream.js';
import type { Server as SocketIoServer } from 'socket.io';

export type { OddsBroadcast };

function fmtTime(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `[${hh}:${mm}:${ss}:${ms}]`;
}

export async function syncOnchainFixtures(): Promise<TokenMap[]> {
  const results: TokenMap[] = [];
  const seen = new Set<string>();

  // 1. Search via public-search
  const searchResults = await searchWorldCupMatches();
  for (const m of searchResults) {
    if (seen.has(m.eventId)) continue;
    seen.add(m.eventId);
    results.push(m);
  }

  // 2. Targeted slug scan — only ±2 days from now with top teams
  const teams = ['fra', 'esp', 'eng', 'ger', 'bra', 'arg', 'por', 'ned'];
  const now = new Date();
  for (let offset = 0; offset <= 2; offset++) {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    const dateStr = d.toISOString().slice(0, 10);
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        const slug = `fifwc-${teams[i]}-${teams[j]}-${dateStr}`;
        const tm = await getEventBySlug(slug);
        if (tm && !seen.has(tm.eventId)) {
          seen.add(tm.eventId);
          results.push(tm);
        }
      }
    }
  }

  console.log(`${fmtTime()} [onchain] found ${results.length} matches`);

  for (const m of results) {
    const matchId = Number(m.eventId);
    await db.insert(matches).values({
      id: matchId,
      txlineFixtureId: matchId,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      competition: 'FIFA World Cup 2026',
      startTime: new Date(m.startTime),
      status: 'scheduled',
      onchainEventSlug: m.eventSlug,
      onchainTokenIds: JSON.stringify({
        home: m.homeTokenId,
        draw: m.drawTokenId,
        away: m.awayTokenId,
      }),
    }).onConflictDoNothing();
  }

  return results;
}

export async function startOnchainOdds(
  io: SocketIoServer,
  fixtureNames: Map<number, { home: string; away: string }>,
): Promise<() => void> {
  const matchTokens = await syncOnchainFixtures();

  if (matchTokens.length === 0) {
    console.log(`${fmtTime()} [onchain] no upcoming matches found`);
    return () => {};
  }

  // Register in fixtureNames
  for (const m of matchTokens) {
    fixtureNames.set(Number(m.eventId), { home: m.homeTeam, away: m.awayTeam });
  }

  console.log(`${fmtTime()} [onchain] streaming ${matchTokens.length} matches`);
  return startOnchainStream(matchTokens, io, fixtureNames);
}
