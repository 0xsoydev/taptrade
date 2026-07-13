'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { Transaction, SystemProgram, PublicKey } from '@solana/web3.js';
import { WalletButton } from './components/WalletButton';
import { useOddsStream } from './hooks/useOddsStream';
import { OddsChart, type GridSquare } from './components/OddsChart';

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:3001';

type BetStatus = 'open' | 'won' | 'lost';

type PlacedBet = {
  row: number;
  targetTime: number;
  outcome: 'home' | 'away' | 'draw';
  status: BetStatus;
  multiplier: number;
};

type Match = {
  id: number;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  onchainEventSlug: string | null;
  onchainTokenIds: { home: string; draw: string; away: string } | null;
};

type BackendBet = {
  id: number;
  matchId: number;
  targetOutcome: 'home' | 'away' | 'draw';
  row: number;
  windowEnd: number;
  status: BetStatus;
  stakeLamports: number;
  payoutLamports: number;
};

type AbstractedWallet = {
  abstractedAddress: string;
  balanceLamports: number;
  balanceSol: number;
};

export default function Home() {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const [matches, setMatches] = useState<Match[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [placedBets, setPlacedBets] = useState<PlacedBet[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedOutcome, setSelectedOutcome] = useState<'home' | 'away' | 'draw'>('home');
  const [abstracted, setAbstracted] = useState<AbstractedWallet | null>(null);
  const [depositing, setDepositing] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { ticks } = useOddsStream(selectedMatch?.id);

  // Fetch abstracted wallet on connect
  useEffect(() => {
    if (!publicKey) { setAbstracted(null); return; }
    const wallet = publicKey.toBase58();
    fetch(`${SERVER_URL}/wallets/${wallet}`)
      .then((r) => r.json() as Promise<AbstractedWallet>)
      .then(setAbstracted)
      .catch(() => {});
  }, [publicKey]);

  // Poll abstracted balance
  useEffect(() => {
    if (!abstracted) return;
    const id = setInterval(() => {
      fetch(`${SERVER_URL}/wallets/${publicKey!.toBase58()}`)
        .then((r) => r.json() as Promise<AbstractedWallet>)
        .then(setAbstracted)
        .catch(() => {});
    }, 10000);
    return () => clearInterval(id);
  }, [abstracted?.abstractedAddress]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    fetch(`${SERVER_URL}/fixtures`)
      .then((r) => r.json())
      .then((data: Match[]) => {
        setMatches(data);
        if (data.length === 0) return;
        const nowMs = Date.now();
        const upcoming = data.filter((m) => Number(m.startTime) >= nowMs);
        setSelectedMatch(upcoming[0] ?? data[data.length - 1]);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!publicKey || !selectedMatch) return;
    const wallet = publicKey.toBase58();

    const load = () => {
      fetch(`${SERVER_URL}/bets/${wallet}`)
        .then((r) => r.json() as Promise<BackendBet[]>)
        .then((bets) => {
          const forMatch = bets.filter((b) => b.matchId === selectedMatch.id);
          setPlacedBets(
            forMatch.map((b) => ({
              row: b.row,
              targetTime: b.windowEnd,
              outcome: b.targetOutcome,
              status: b.status,
              multiplier: b.payoutLamports / b.stakeLamports,
            })),
          );
        })
        .catch(() => {});
    };

    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [publicKey, selectedMatch]);

  const deposit = useCallback(async (solAmount: number) => {
    if (!publicKey || !signTransaction || !abstracted) return;
    setDepositing(true);
    try {
      const lamports = Math.round(solAmount * 1e9);
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(abstracted.abstractedAddress),
          lamports,
        }),
      );
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      const signed = await signTransaction(tx);
      await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction({ signature: tx.signatures[0].signature!.toString(), blockhash, lastValidBlockHeight }, 'confirmed');
      // Refresh balance
      const fresh = await fetch(`${SERVER_URL}/wallets/${publicKey.toBase58()}`).then((r) => r.json() as Promise<AbstractedWallet>);
      setAbstracted(fresh);
    } catch {
      // deposit failed silently
    } finally {
      setDepositing(false);
    }
  }, [publicKey, signTransaction, abstracted, connection]);

  const handleBet = useCallback(async (square: GridSquare) => {
    if (!publicKey || !selectedMatch) return;
    try {
      const res = await fetch(`${SERVER_URL}/bets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          externalWallet: publicKey.toBase58(),
          matchId: selectedMatch.id,
          marketType: square.outcome === 'home' && selectedMatch.onchainEventSlug ? 'ONCHAIN_1X2' : '1X2_PARTICIPANT_RESULT',
          targetOutcome: square.outcome,
          row: square.row,
          minPct: square.yMin,
          maxPct: square.yMax,
          windowStart: Date.now(),
          windowEnd: square.targetTime,
          multiplier: square.multiplier,
        }),
      });
      if (!res.ok) throw new Error('bet failed');
      setPlacedBets((prev) => [
        ...prev,
        {
          row: square.row,
          targetTime: square.targetTime,
          outcome: square.outcome,
          status: 'open',
          multiplier: square.multiplier,
        },
      ]);
    } catch {
      // bet failed silently
    }
  }, [publicKey, selectedMatch]);

  return (
    <div className="h-screen w-screen bg-[#110811] text-white flex overflow-hidden font-sans">
      {/* Sidebar */}
      <div className="w-[240px] m-4 rounded-[24px] bg-[#1a0e16] border border-white/5 flex flex-col justify-between py-6 px-4 z-10 shadow-2xl relative">
        <div>
          <div className="flex items-center gap-2 px-2 mb-10">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
            <span className="text-xl font-black italic tracking-tight">TapTrade</span>
          </div>
          <nav className="space-y-2">
            <button className="flex items-center gap-3 w-full px-4 py-3 rounded-xl bg-white/5 text-white transition-colors text-sm font-semibold">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
              Trade
            </button>
          </nav>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 relative">
        <OddsChart
          ticks={ticks}
          matchId={selectedMatch?.id}
          onBet={handleBet}
          placedBets={placedBets}
          selectedOutcome={selectedOutcome}
          hasBalance={(abstracted?.balanceLamports ?? 0) > 1_000_000}
        />

        {/* Top Left Match Selector */}
        <div className="absolute top-6 left-6 z-20" ref={dropdownRef}>
          <button
            onClick={() => setShowDropdown((prev) => !prev)}
            className="flex items-center gap-3 px-4 py-2 bg-[#1a0e16] border border-white/5 rounded-full shadow-lg"
          >
            {matches.length > 0 && selectedMatch ? (
              <>
                <span className="text-[#00E676] font-mono font-bold text-sm">
                  {selectedMatch.homeTeam} vs {selectedMatch.awayTeam}
                </span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9C818C" strokeWidth="2" className={`transition-transform ${showDropdown ? 'rotate-180' : ''}`}><path d="M6 9l6 6 6-6"/></svg>
              </>
            ) : (
              <span className="text-sm text-gray-400">Loading...</span>
            )}
          </button>
          {showDropdown && matches.length > 0 && (
            <div className="absolute top-full mt-2 w-72 bg-[#1a0e16] border border-white/5 rounded-2xl shadow-2xl overflow-hidden">
              {matches.map((m) => {
                const isActive = m.id === selectedMatch?.id;
                const startMs = Number(m.startTime);
                const startLabel = new Date(startMs).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                return (
                  <button
                    key={m.id}
                    onClick={() => { setSelectedMatch(m); setShowDropdown(false); setPlacedBets([]); }}
                    className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${isActive ? 'bg-white/5' : 'hover:bg-white/5'}`}
                  >
                    <div>
                      <div className={`text-sm font-semibold ${isActive ? 'text-[#00E676]' : 'text-white'}`}>{m.homeTeam} vs {m.awayTeam}</div>
                      <div className="text-xs text-[#9C818C]">{startLabel}</div>
                    </div>
                    {isActive && <div className="w-2 h-2 rounded-full bg-[#00E676]" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Outcome Selector */}
        <div className="absolute top-20 left-6 z-20 flex gap-1.5">
          {([
            { key: 'home' as const, label: 'HOME', color: '#00E676' },
            { key: 'draw' as const, label: 'DRAW', color: '#FFC107' },
            { key: 'away' as const, label: 'AWAY', color: '#FF5252' },
          ]).map(({ key, label, color }) => (
            <button
              key={key}
              onClick={() => setSelectedOutcome(key)}
              className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all ${selectedOutcome === key ? 'text-black' : 'bg-black/40 text-[#9C818C] hover:text-white'}`}
              style={selectedOutcome === key ? { background: color } : undefined}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Top Right: Wallet + Balance + Deposit */}
        <div className="absolute top-6 right-6 z-20 flex items-center gap-3">
          {abstracted && (
            <div className="flex items-center gap-4 bg-[#1a0e16] border border-white/5 rounded-full px-4 py-2 shadow-lg">
              <span className="text-xs font-mono text-[#9C818C]">
                {abstracted.balanceSol.toFixed(3)} SOL
              </span>
              <button
                onClick={() => deposit(0.01)}
                disabled={depositing}
                className="px-3 py-1 rounded-full bg-[#E95B8C] text-white text-xs font-bold disabled:opacity-50"
              >
                {depositing ? '...' : 'Deposit'}
              </button>
            </div>
          )}
          <WalletButton />
        </div>

        {/* Bottom: Bet Size (fixed 0.001 SOL) */}
        <div className="absolute bottom-6 right-6 z-20">
          <div className="flex items-center gap-2 bg-[#1a0e16] border border-white/5 rounded-full px-4 py-2 shadow-lg">
            <span className="text-[#9C818C] text-sm">Bet Size</span>
            <span className="text-sm font-bold font-mono text-white">0.001 SOL</span>
          </div>
        </div>
      </div>
    </div>
  );
}
