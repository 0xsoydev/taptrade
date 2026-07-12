import { db } from '../db/index.js';
import { matches } from '../db/schema.js';
import type { AxiosInstance } from 'axios';

export type Fixture = {
  FixtureId: number;
  Participant1: string;
  Participant2: string;
  Competition: string;
  StartTime: number;
  GameState?: number;
};

export async function syncFixtures(client: AxiosInstance): Promise<void> {
  const res = await client.get<Fixture[]>('/fixtures/snapshot', { params: { competitionId: 72 } });
  const rows = res.data.map((f) => ({
    id: f.FixtureId,
    txlineFixtureId: f.FixtureId,
    homeTeam: f.Participant1,
    awayTeam: f.Participant2,
    competition: f.Competition,
    startTime: new Date(f.StartTime),
    status: String(f.GameState ?? 1),
  }));

  await db.insert(matches).values(rows).onConflictDoNothing();
}
