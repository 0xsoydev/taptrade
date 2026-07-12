'use client';

import { useState, useEffect, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletButton } from './components/WalletButton';
import { useOddsStream } from './hooks/useOddsStream';
import { OddsChart, type GridSquare } from './components/OddsChart';
import { BetModal } from './components/BetModal';

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

export default function Home() {
  const { publicKey } = useWallet();
  const [matches, setMatches] = useState<Match[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<GridSquare | null>(null);
  const [placedBets, setPlacedBets] = useState<PlacedBet[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedOutcome, setSelectedOutcome] = useState<'home' | 'away' | 'draw'>('home');

  const { ticks } = useOddsStream(selectedMatch?.id);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
    fetch(`${SERVER_URL}/health`).catch(() => null);
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

  const handleBetPlaced = () => {
    if (selectedSquare) {
      setPlacedBets((prev) => [
        ...prev,
        {
          row: selectedSquare.row,
          targetTime: selectedSquare.targetTime,
          outcome: selectedSquare.outcome,
          status: 'open',
          multiplier: selectedSquare.multiplier,
        },
      ]);
    }
    setSelectedSquare(null);
  };

  const marketType = selectedMatch?.onchainEventSlug ? 'ONCHAIN_1X2' : '1X2_PARTICIPANT_RESULT';

  return (
    <div className="h-screen w-screen bg-[#110811] text-white flex overflow-hidden font-sans">
      
      {/* Sidebar */}
      <div className="w-[240px] m-4 rounded-[24px] bg-[#1a0e16] border border-white/5 flex flex-col justify-between py-6 px-4 z-10 shadow-2xl relative">
        <div>
          <div className="flex items-center gap-2 px-2 mb-10">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
            <span className="text-xl font-black italic tracking-tight">euphoria</span>
          </div>

          <nav className="space-y-2">
            <button className="flex items-center gap-3 w-full px-4 py-3 rounded-xl bg-white/5 text-white transition-colors text-sm font-semibold">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
              Trade
            </button>
            <button className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-[#9C818C] hover:bg-white/5 hover:text-white transition-colors text-sm font-medium">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              Leaderboard
            </button>
            <button className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-[#9C818C] hover:bg-white/5 hover:text-white transition-colors text-sm font-medium">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              Profile
            </button>
          </nav>
        </div>

        <div className="flex items-center justify-between px-4 text-[#9C818C]">
          <button className="hover:text-white"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
          <button className="hover:text-white"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 relative">
        <OddsChart
          ticks={ticks}
          matchId={selectedMatch?.id}
          onSelectSquare={setSelectedSquare}
          placedBets={placedBets}
          selectedOutcome={selectedOutcome}
        />

        {/* Top Left Match Selector */}
        <div className="absolute top-6 left-6 z-20" ref={dropdownRef}>
          <button
            onClick={() => setShowDropdown((prev) => !prev)}
            className="flex items-center gap-3 px-4 py-2 bg-[#1a0e16] border border-white/5 rounded-full shadow-lg"
          >
            {matches.length > 0 && selectedMatch ? (
              <>
                <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center text-[10px] font-bold">W</div>
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
                    className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${
                      isActive ? 'bg-white/5' : 'hover:bg-white/5'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${isActive ? 'bg-[#00E676] text-black' : 'bg-white/10 text-[#9C818C]'}`}>W</div>
                      <div>
                        <div className={`text-sm font-semibold ${isActive ? 'text-[#00E676]' : 'text-white'}`}>
                          {m.homeTeam} vs {m.awayTeam}
                        </div>
                        <div className="text-xs text-[#9C818C]">{startLabel}</div>
                      </div>
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
              className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all ${
                selectedOutcome === key
                  ? 'text-black'
                  : 'bg-black/40 text-[#9C818C] hover:text-white'
              }`}
              style={selectedOutcome === key ? { background: color } : undefined}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Top Right User Overlay */}
        <div className="absolute top-6 right-6 z-20 flex items-center gap-3">
          <div className="flex items-center gap-4 bg-[#1a0e16] border border-white/5 rounded-full px-4 py-2 shadow-lg">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-[#fca5a5] text-black flex items-center justify-center text-xs font-bold">A</div>
              <span className="text-xs font-mono text-[#9C818C]">0</span>
            </div>
            <div className="w-px h-4 bg-white/10" />
            <div className="flex items-center gap-2 text-xs font-mono text-[#9C818C]">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
              0
            </div>
            <div className="w-px h-4 bg-white/10" />
            <div className="flex items-center gap-2 text-xs font-mono text-[#9C818C]">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
              $0
            </div>
            <div className="w-px h-4 bg-white/10" />
            <div className="flex gap-0.5 items-end h-4">
              <div className="w-1 bg-[#9C818C] h-[40%]" />
              <div className="w-1 bg-[#9C818C] h-[60%]" />
              <div className="w-1 bg-[#9C818C] h-[80%]" />
              <div className="w-1 bg-[#9C818C] h-[100%]" />
            </div>
          </div>
          <WalletButton />
        </div>

        {/* Bottom Left Overlay */}
        <div className="absolute bottom-6 left-6 z-20">
          <div className="flex items-center gap-2 bg-[#1a0e16] border border-white/5 rounded-full px-4 py-2 shadow-lg">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#E95B8C" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <span className="text-sm font-bold font-mono">$0.00</span>
          </div>
        </div>

        {/* Bottom Right Overlay */}
        <div className="absolute bottom-6 right-6 z-20">
          <div className="flex items-center gap-2 bg-[#1a0e16] border border-white/5 rounded-full px-4 py-2 shadow-lg cursor-pointer hover:bg-white/5">
            <span className="text-[#9C818C] text-sm">Bet Size</span>
            <span className="text-sm font-bold font-mono text-white">$10.0</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9C818C" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
          </div>
        </div>
      </div>

      <BetModal
        square={selectedSquare}
        matchId={selectedMatch?.id ?? 0}
        marketType={marketType}
        onClose={() => setSelectedSquare(null)}
        onBetPlaced={handleBetPlaced}
      />
    </div>
  );
}
