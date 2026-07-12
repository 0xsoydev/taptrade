'use client';

import { useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import type { GridSquare } from './OddsChart';

type Props = {
  square: GridSquare | null;
  matchId: number;
  marketType: string;
  onClose: () => void;
  onBetPlaced: () => void;
};

const GAME_WALLET = new PublicKey('2sgTmbY8wU1WZZNXnAivTaSF9qj8FjJDCeJu8wcSJu9A');
const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:3001';

const STAKES = [0.01, 0.1, 0.25, 0.5, 0.75, 1] as const;

export function BetModal({ square, matchId, marketType, onClose, onBetPlaced }: Props) {
  const { publicKey, signTransaction } = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const { connection } = useConnection();
  const [stake, setStake] = useState<number>(STAKES[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!square) return null;

  if (!publicKey) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
        <div className="bg-gray-900 rounded-xl p-6 w-96 border border-gray-700">
          <h3 className="text-xl font-bold mb-4">Connect Wallet</h3>
          <p className="text-sm text-gray-400 mb-4">Connect a Solana wallet to place this bet.</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 px-4 py-2 rounded bg-gray-800 text-gray-300">
              Cancel
            </button>
            <button
              onClick={() => setWalletModalVisible(true)}
              className="flex-1 px-4 py-2 rounded bg-green-600 text-white font-bold"
            >
              Connect Wallet
            </button>
          </div>
        </div>
      </div>
    );
  }

  const payout = stake * square.multiplier;
  const windowSec = Math.round((square.targetTime - Date.now()) / 1000);

  async function placeBet() {
    if (!publicKey || !signTransaction || !square) return;
    // Captured before wallet approval/confirmation, which can easily take several
    // seconds (or tens of seconds for a real user clicking through a wallet popup).
    // Using post-confirmation time here would push windowStart past windowEnd for
    // near-term squares, making the settlement window empty and the bet unwinnable
    // no matter what the price actually did.
    const windowStart = Date.now();
    setLoading(true);
    setError(null);

    try {
      const lamports = Math.round(stake * LAMPORTS_PER_SOL);
      const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: GAME_WALLET, lamports })
      );

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;

      const signed = await signTransaction!(tx);
      const txSig = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction({ signature: txSig, blockhash, lastValidBlockHeight }, 'confirmed');

      const res = await fetch(`${SERVER_URL}/bets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userWallet: publicKey.toBase58(),
          matchId,
          marketType,
          targetOutcome: square.outcome,
          row: square.row,
          minPct: square.yMin,
          maxPct: square.yMax,
          windowStart,
          windowEnd: square.targetTime,
          stakeLamports: lamports,
          payoutLamports: Math.round(payout * LAMPORTS_PER_SOL),
          txSignature: txSig,
        }),
      });

      if (!res.ok) throw new Error('Failed to record bet');
      onBetPlaced();
      onClose();
    } catch (err: any) {
      setError(err.message ?? 'Transaction failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-xl p-6 w-96 border border-gray-700">
        <h3 className="text-xl font-bold mb-4">Place Bet</h3>

        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Target Outcome</span>
            <span className="uppercase font-bold" style={{ color: square.outcome === 'home' ? '#00E676' : square.outcome === 'away' ? '#FF5252' : '#FFC107' }}>{square.outcome}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Target Range</span>
            <span>{square.yMin.toFixed(0)}% - {square.yMax.toFixed(0)}%</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Multiplier</span>
            <span className="text-green-400 font-bold">{square.multiplier.toFixed(2)}x</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Time Window</span>
            <span>{windowSec}s</span>
          </div>

          <div>
            <label className="text-sm text-gray-400 mb-2 block">Stake (SOL)</label>
            <div className="flex gap-2">
              {STAKES.map((s) => (
                <button
                  key={s}
                  onClick={() => setStake(s)}
                  className={`px-3 py-1 rounded text-sm ${stake === s ? 'bg-blue-600' : 'bg-gray-800'}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-gray-700 pt-3">
            <div className="flex justify-between">
              <span>Payout</span>
              <span className="text-green-400 font-bold text-lg">{payout.toFixed(4)} SOL</span>
            </div>
          </div>

          {error && <div className="text-red-400 text-sm">{error}</div>}

          <div className="flex gap-2 mt-4">
            <button onClick={onClose} className="flex-1 px-4 py-2 rounded bg-gray-800 text-gray-300">
              Cancel
            </button>
            <button
              onClick={placeBet}
              disabled={loading}
              className="flex-1 px-4 py-2 rounded bg-green-600 text-white font-bold disabled:opacity-50"
            >
              {loading ? 'Placing...' : 'Bet'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
