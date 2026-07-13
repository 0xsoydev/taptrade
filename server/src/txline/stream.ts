import { EventSource } from 'eventsource';
import { db } from '../db/index.js';
import { oddsTicks } from '../db/schema.js';
import { TXLINE_API_BASE_URL } from './config.js';
import type { Server as SocketIoServer } from 'socket.io';

export type OddsPayload = {
  FixtureId: number;
  MessageId: string;
  Ts: number;
  Bookmaker: string;
  BookmakerId: number;
  SuperOddsType: string;
  GameState: number | null;
  InRunning: boolean;
  MarketParameters: string | null;
  MarketPeriod: string | null;
  PriceNames: string[];
  Prices: number[];
  Pct: string[];
};

/** The clean payload shape sent to the frontend via websocket */
export type OddsBroadcast = {
  matchId: number;
  home: number;
  away: number;
  draw: number;
  ts: number;
};

function parsePct(value: string): number | null {
  if (value === 'NA') return null;
  const n = parseFloat(value);
  return Number.isNaN(n) ? null : n;
}

export function normalizeOdds(payload: OddsPayload): typeof oddsTicks.$inferInsert | null {
  if (payload.PriceNames.length < 2 || payload.Prices.length < 2) return null;

  return {
    matchId: payload.FixtureId,
    marketType: payload.SuperOddsType,
    marketParams: payload.MarketParameters,
    marketPeriod: payload.MarketPeriod,
    priceHome: payload.Prices[0],
    priceDraw: payload.PriceNames.length > 2 ? payload.Prices[2] : null,
    priceAway: payload.Prices[1],
    pctHome: parsePct(payload.Pct[0]) ?? 0,
    pctDraw: payload.PriceNames.length > 2 ? parsePct(payload.Pct[2]) : null,
    pctAway: parsePct(payload.Pct[1]) ?? 0,
    ts: payload.Ts,
    inRunning: payload.InRunning,
  };
}

type HeartbeatPayload = { Ts: number };

function isHeartbeat(payload: unknown): payload is HeartbeatPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    Object.keys(payload).length === 1 &&
    'Ts' in payload
  );
}

/** Format a timestamp as [HH:MM:SS:mmm] */
function fmtTime(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `[${hh}:${mm}:${ss}:${ms}]`;
}

export function startOddsStream(
  apiToken: string,
  jwt: string,
  io: SocketIoServer,
  fixtureNames: Map<number, { home: string; away: string }>,
): () => void {
  const url = `${TXLINE_API_BASE_URL}/odds/stream`;
  const eventSource = new EventSource(url, {
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

  eventSource.onmessage = async (event) => {
    try {
      const raw: unknown = JSON.parse(event.data);

      if (isHeartbeat(raw)) {
        console.log(`${fmtTime()} heartbeat`);
        return;
      }

      const payload = raw as OddsPayload;
      const tick = normalizeOdds(payload);
      if (!tick) return;

      // Persist every tick to the database (fire-and-forget)
      db.insert(oddsTicks).values(tick).catch(() => {});

      // Only broadcast full-match 1X2 odds (marketPeriod === null)
      if (tick.marketType === '1X2_PARTICIPANT_RESULT' && tick.marketPeriod === null) {
        const names = fixtureNames.get(tick.matchId);
        const label = names ? `${names.home} v/ ${names.away}` : `Match ${tick.matchId}`;
        const home = tick.pctHome;
        const away = tick.pctAway;
        const draw = tick.pctDraw ?? 0;

        console.log(
          `${fmtTime()} <${label}> HOME: ${home.toFixed(1)}%, AWAY: ${away.toFixed(1)}%, DRAW: ${draw.toFixed(1)}%`,
        );

        // Build the clean broadcast payload
        const broadcast: OddsBroadcast = {
          matchId: tick.matchId,
          home,
          away,
          draw,
          ts: tick.ts,
        };

        // Emit only to clients subscribed to this match's room
        const room = io.sockets.adapter.rooms.get(String(tick.matchId));
        if (room && room.size > 0) {
          io.to(String(tick.matchId)).emit('odds:tick', broadcast);
        }
      }
    } catch (err) {
      console.error(`${fmtTime()} [stream] parse error:`, err);
    }
  };

  eventSource.onerror = (err) => console.error(`${fmtTime()} [stream] SSE error:`, err);

  return () => {
    eventSource.close();
  };
}
