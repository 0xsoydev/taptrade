import { EVENT_API, ORDERBOOK_API } from './config.js';

export type TokenMap = {
  homeTokenId: string;
  drawTokenId: string;
  awayTokenId: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  eventSlug: string;
  eventId: string;
};

type MarketMeta = {
  id: string;
  question: string;
  groupItemTitle: string;
  clobTokenIds: string | string[];
  outcomePrices: string | string[];
  outcomes: string[];
  conditionId: string;
};

type EventMeta = {
  id: string;
  title: string;
  slug: string;
  startTime: string;
  markets: MarketMeta[];
};

function parseTokenIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return [];
}

function find1X2Markets(event: EventMeta): TokenMap | null {
  const markets = event.markets;
  if (!markets || markets.length < 3) return null;

  const drawMarket = markets.find(
    (m) => m.groupItemTitle?.toLowerCase().includes('draw')
      && parseTokenIds(m.clobTokenIds).length === 2,
  );
  if (!drawMarket) return null;

  const others = markets.filter(
    (m) => m !== drawMarket && parseTokenIds(m.clobTokenIds).length === 2,
  );
  if (others.length < 2) return null;

  let homeMarket = others[0];
  let awayMarket = others[1];

  const vsMatch = event.title.match(/^(.+?)\s+vs\.?\s+(.+?)$/i);
  if (vsMatch) {
    const homeName = vsMatch[1].trim();
    const awayName = vsMatch[2].trim();
    const foundHome = others.find((m) =>
      m.groupItemTitle.toLowerCase().includes(homeName.toLowerCase()),
    );
    const foundAway = others.find((m) =>
      m.groupItemTitle.toLowerCase().includes(awayName.toLowerCase()),
    );
    if (foundHome && foundAway) {
      homeMarket = foundHome;
      awayMarket = foundAway;
    }
  }

  return {
    homeTokenId: parseTokenIds(homeMarket.clobTokenIds)[0],
    drawTokenId: parseTokenIds(drawMarket.clobTokenIds)[0],
    awayTokenId: parseTokenIds(awayMarket.clobTokenIds)[0],
    homeTeam: homeMarket.groupItemTitle,
    awayTeam: awayMarket.groupItemTitle,
    startTime: event.startTime,
    eventSlug: event.slug,
    eventId: event.id,
  };
}

async function fetchEventBySlug(slug: string): Promise<TokenMap | null> {
  try {
    const res = await fetch(`${EVENT_API}/events?slug=${slug}`);
    if (!res.ok) return null;
    const events = await res.json() as EventMeta[];
    if (!events.length) return null;
    const e = events[0];
    if (!e.startTime || e.slug !== slug) return null;
    return find1X2Markets(e);
  } catch {
    return null;
  }
}

// ponytail: public-search finds indexed events, then we cache in DB
export async function searchWorldCupMatches(): Promise<TokenMap[]> {
  const results: TokenMap[] = [];
  const seen = new Set<string>();

  // 1. Public search — only indexed events
  const queries = ['world cup 2026', 'fifwc', 'world cup vs'];
  for (const q of queries) {
    try {
      const url = `${EVENT_API}/public-search?q=${encodeURIComponent(q)}&events_status=active&limit_per_type=50`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json() as { events?: EventMeta[] };
      for (const event of data.events ?? []) {
        if (seen.has(event.id)) continue;
        seen.add(event.id);
        if (!event.startTime || !event.slug?.startsWith('fifwc-')) continue;
        const tm = find1X2Markets(event);
        if (tm) results.push(tm);
      }
    } catch {}
  }

  return results;
}

export async function getEventBySlug(slug: string): Promise<TokenMap | null> {
  return fetchEventBySlug(slug);
}

export async function getInitialPrices(tokenIds: string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  for (const id of tokenIds) {
    try {
      const res = await fetch(`${ORDERBOOK_API}/price?token_id=${id}&side=BUY`);
      if (!res.ok) continue;
      const data = await res.json() as { price: string };
      prices.set(id, parseFloat(data.price));
    } catch {}
  }
  return prices;
}
