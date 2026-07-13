import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { setupTxline } from './txline/subscribe.js';
import { startOddsStream, type OddsBroadcast } from './txline/stream.js';
import { syncFixtures } from './txline/fixtures.js';
import { startKeeper } from './keeper.js';
import { startOnchainOdds } from './onchain_odds/index.js';
import healthRouter from './routes/health.js';
import betsRouter from './routes/bets.js';
import fixturesRouter from './routes/fixtures.js';
import walletsRouter from './routes/wallets.js';
import { db } from './db/index.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use('/health', healthRouter);
app.use('/wallets', walletsRouter);
app.use('/bets', betsRouter);
app.use('/fixtures', fixturesRouter);

/** Format a timestamp as [HH:MM:SS:mmm] */
function fmtTime(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `[${hh}:${mm}:${ss}:${ms}]`;
}

const port = Number(process.env.PORT) || 3001;
httpServer.listen(port, () => console.log(`${fmtTime()} server listening on :${port}`));

async function main() {
  const { apiToken, jwt, axios: txlineClient } = await setupTxline();
  console.log(`${fmtTime()} TxLINE API token acquired`);

  await syncFixtures(txlineClient);
  console.log(`${fmtTime()} fixtures synced`);

  // Build a name lookup: fixtureId -> { home, away }
  const fixtureRows = await db.query.matches.findMany({
    columns: { txlineFixtureId: true, homeTeam: true, awayTeam: true },
  });
  const fixtureNames = new Map<number, { home: string; away: string }>(
    fixtureRows.map((r) => [r.txlineFixtureId, { home: r.homeTeam, away: r.awayTeam }]),
  );

  // ──────────────────────────────────────────────────
  // WebSocket subscription model
  // ──────────────────────────────────────────────────
  io.on('connection', (socket) => {
    console.log(`${fmtTime()} [ws] client connected: ${socket.id}`);

    /**
     * 'subscribe' — the client wants odds for a specific match.
     * - Leave all previous match rooms
     * - Join the new match room
     * - Send historical odds as the initial payload
     */
    socket.on('subscribe', async (matchId: number) => {
      // Leave every room except the socket's own room (socket.id)
      for (const room of socket.rooms) {
        if (room !== socket.id) {
          socket.leave(room);
        }
      }

      const roomName = String(matchId);
      socket.join(roomName);

      const names = fixtureNames.get(matchId);
      const label = names ? `${names.home} v/ ${names.away}` : `Match ${matchId}`;
      console.log(`${fmtTime()} [ws] ${socket.id} subscribed → <${label}>`);

      // Fetch full-match 1X2 history for this match (TxLINE + onchain)
      const history = await db.query.oddsTicks.findMany({
        where: (t, { eq, and, or, isNull }) =>
          and(
            eq(t.matchId, matchId),
            or(
              and(
                eq(t.marketType, '1X2_PARTICIPANT_RESULT'),
                isNull(t.marketPeriod),
              ),
              eq(t.marketType, 'ONCHAIN_1X2'),
            ),
          ),
        orderBy: (t, { asc }) => asc(t.ts),
        limit: 200,
      });

      // Map the raw DB rows to the clean OddsBroadcast shape
      const mapped: OddsBroadcast[] = history.map((row) => ({
        matchId: row.matchId,
        home: row.pctHome,
        away: row.pctAway,
        draw: row.pctDraw ?? 0,
        ts: row.ts,
      }));

      console.log(`${fmtTime()} [ws] sent ${mapped.length} history ticks to ${socket.id}`);
      socket.emit('odds:history', mapped);
    });

    socket.on('disconnect', () => {
      console.log(`${fmtTime()} [ws] client disconnected: ${socket.id}`);
    });
  });

  const stopStream = startOddsStream(apiToken, jwt, io, fixtureNames);
  const stopOnchain = await startOnchainOdds(io, fixtureNames);
  const stopKeeper = startKeeper();

  process.on('SIGINT', () => {
    stopStream();
    stopOnchain();
    stopKeeper();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[main] fatal:', err);
  process.exit(1);
});
