import WebSocket from 'ws';
import { db } from '../db/index.js';
import { oddsTicks } from '../db/schema.js';
import { ORDERBOOK_WS } from './config.js';
import type { Server as SocketIoServer } from 'socket.io';
import type { TokenMap } from './resolver.js';

export type OddsBroadcast = {
  matchId: number;
  home: number;
  away: number;
  draw: number;
  ts: number;
};

type PriceChangeMsg = {
  event_type: 'price_change';
  market: string;
  price_changes: Array<{
    asset_id: string;
    price: string;
    size: string;
    side: string;
    best_bid?: string;
    best_ask?: string;
  }>;
  timestamp: string;
};

type BookSnapshotMsg = {
  event_type: 'book';
  market: string;
  asset_id: string;
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
  timestamp: string;
};

type LastTradeMsg = {
  event_type: 'last_trade_price';
  market: string;
  asset_id: string;
  price: string;
};

type WSMessage = PriceChangeMsg | BookSnapshotMsg | LastTradeMsg;

function fmtTime(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `[${hh}:${mm}:${ss}:${ms}]`;
}

export function startOnchainStream(
  matches: TokenMap[],
  io: SocketIoServer,
  fixtureNames: Map<number, { home: string; away: string }>,
): () => void {
  if (matches.length === 0) {
    console.log(`${fmtTime()} [onchain] no matches to stream`);
    return () => {};
  }

  // Build token→match lookup
  const tokenToMatch = new Map<string, { matchId: number; outcome: 'home' | 'draw' | 'away' }>();
  const allTokenIds: string[] = [];

  for (const m of matches) {
    const matchId = Number(m.eventId);
    tokenToMatch.set(m.homeTokenId, { matchId, outcome: 'home' });
    tokenToMatch.set(m.drawTokenId, { matchId, outcome: 'draw' });
    tokenToMatch.set(m.awayTokenId, { matchId, outcome: 'away' });
    allTokenIds.push(m.homeTokenId, m.drawTokenId, m.awayTokenId);

    // Register in fixtureNames
    fixtureNames.set(matchId, { home: m.homeTeam, away: m.awayTeam });
  }

  // Track latest best_bid per token per match
  const latestPrices = new Map<number, { home: number; draw: number; away: number }>();

  let ws: WebSocket;
  let reconnectDelay = 1000;
  let alive = false;
  let aliveCheck: NodeJS.Timeout;

  function connect() {
    ws = new WebSocket(ORDERBOOK_WS);

    ws.on('open', () => {
      console.log(`${fmtTime()} [onchain] WS connected`);
      reconnectDelay = 1000;

      ws.send(JSON.stringify({
        assets_ids: allTokenIds,
        type: 'market',
        initial_dump: true,
        level: 2,
      }));
      console.log(`${fmtTime()} [onchain] subscribed to ${allTokenIds.length} tokens`);

      // Heartbeat check
      alive = true;
      aliveCheck = setInterval(() => {
        if (!alive) {
          console.log(`${fmtTime()} [onchain] WS no pong, reconnecting...`);
          ws.terminate();
          return;
        }
        alive = false;
        ws.ping();
      }, 30000);
    });

    ws.on('pong', () => { alive = true; });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as WSMessage;
        handleMessage(msg);
      } catch (err) {
        console.error(`${fmtTime()} [onchain] parse error:`, err);
      }
    });

    ws.on('error', (err) => {
      console.error(`${fmtTime()} [onchain] WS error:`, err.message);
    });

    ws.on('close', () => {
      console.log(`${fmtTime()} [onchain] WS closed, reconnecting in ${reconnectDelay}ms`);
      clearInterval(aliveCheck);
      setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
        connect();
      }, reconnectDelay);
    });
  }

  function updatePrice(assetId: string, bidRaw: string | undefined, askRaw: string | undefined) {
    const mapping = tokenToMatch.get(assetId);
    if (!mapping) return;

    const bid = bidRaw ? parseFloat(bidRaw) : NaN;
    const ask = askRaw ? parseFloat(askRaw) : NaN;
    if (Number.isNaN(bid)) return;

    // ponytail: mid-price moves more often than best_bid alone
    const price = Number.isNaN(ask) ? bid : (bid + ask) / 2;
    const pct = price * 100;

    // Update latest prices
    let current = latestPrices.get(mapping.matchId) ?? { home: 0, draw: 0, away: 0 };
    current[mapping.outcome] = pct;
    latestPrices.set(mapping.matchId, current);

    // Only broadcast when we have all 3 outcomes
    if (current.home > 0 && current.away > 0) {
      const ts = Date.now();
      const names = fixtureNames.get(mapping.matchId);
      const label = names ? `${names.home} v/ ${names.away}` : `Match ${mapping.matchId}`;

      console.log(
        `${fmtTime()} [onchain] <${label}> HOME: ${current.home.toFixed(1)}% AWAY: ${current.away.toFixed(1)}% DRAW: ${current.draw.toFixed(1)}%`,
      );

      // Persist to DB
      db.insert(oddsTicks).values({
        matchId: mapping.matchId,
        marketType: 'ONCHAIN_1X2',
        marketParams: null,
        marketPeriod: null,
        priceHome: Math.round(current.home * 1000),
        priceDraw: Math.round(current.draw * 1000),
        priceAway: Math.round(current.away * 1000),
        pctHome: current.home,
        pctDraw: current.draw,
        pctAway: current.away,
        ts,
        inRunning: false,
      }).catch(() => {});

      // Broadcast to room
      const broadcast: OddsBroadcast = {
        matchId: mapping.matchId,
        home: current.home,
        draw: current.draw,
        away: current.away,
        ts,
      };

      const room = io.sockets.adapter.rooms.get(String(mapping.matchId));
      if (room && room.size > 0) {
        io.to(String(mapping.matchId)).emit('odds:tick', broadcast);
      }
    }
  }

  function handleMessage(msg: WSMessage) {
    if (msg.event_type === 'price_change') {
      for (const pc of msg.price_changes) {
        updatePrice(pc.asset_id, pc.best_bid, pc.best_ask);
      }
    } else if (msg.event_type === 'book') {
      updatePrice(msg.asset_id, msg.bids[0]?.price, msg.asks[0]?.price);
    }
  }

  connect();

  return () => {
    clearInterval(aliveCheck);
    ws.close();
  };
}
