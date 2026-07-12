'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

/** Clean tick shape — matches the backend's OddsBroadcast */
export type OddsTick = {
  matchId: number;
  home: number;
  away: number;
  draw: number;
  ts: number;
};

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:3001';

/**
 * useOddsStream — subscribes to live odds for a single match.
 *
 * When matchId changes the hook sends a 'subscribe' event so the
 * backend switches the room.  History is received once, then live
 * ticks arrive one at a time via 'odds:tick'.
 */
export function useOddsStream(matchId: number | undefined) {
  const [ticks, setTicks] = useState<OddsTick[]>([]);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const matchIdRef = useRef(matchId);

  matchIdRef.current = matchId;

  // ── History handler ──────────────────────────────
  const handleHistory = useCallback((history: OddsTick[]) => {
    console.log(`[ws] history received — ${history.length} ticks`);
    setTicks(history);
  }, []);

  // ── Live tick handler ────────────────────────────
  const handleTick = useCallback((tick: OddsTick) => {
    // Guard: only accept ticks for the currently selected match
    if (tick.matchId !== matchIdRef.current) return;

    console.log(
      `[ws] tick — match=${tick.matchId} HOME=${tick.home.toFixed(1)}% AWAY=${tick.away.toFixed(1)}% DRAW=${tick.draw.toFixed(1)}%`,
    );

    setTicks((prev) => {
      const next = [...prev, tick];
      // Keep a rolling window of 500 ticks max
      return next.length > 500 ? next.slice(-500) : next;
    });
  }, []);

  // ── Socket lifecycle ─────────────────────────────
  useEffect(() => {
    if (!matchId) return;

    // If we already have a connection, just re-subscribe
    if (socketRef.current?.connected) {
      console.log(`[ws] re-subscribing to match ${matchId}`);
      setTicks([]); // clear old ticks
      socketRef.current.emit('subscribe', matchId);
      return;
    }

    const socket = io(SERVER_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[ws] connected');
      setConnected(true);
      console.log(`[ws] subscribing to match ${matchId}`);
      socket.emit('subscribe', matchId);
    });

    socket.on('disconnect', () => {
      console.log('[ws] disconnected');
      setConnected(false);
    });

    socket.on('odds:history', handleHistory);
    socket.on('odds:tick', handleTick);

    return () => {
      socket.off('odds:history', handleHistory);
      socket.off('odds:tick', handleTick);
      socket.disconnect();
      socketRef.current = null;
      setTicks([]);
    };
    // NOTE: we intentionally only create the socket once.
    // Re-subscriptions happen via the early-return path above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  return { ticks, connected };
}
