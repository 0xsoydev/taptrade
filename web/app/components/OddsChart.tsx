'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import type { OddsTick } from '../hooks/useOddsStream';

export type GridSquare = {
  col: number;
  row: number;
  yMin: number;
  yMax: number;
  multiplier: number;
  targetTime: number;
  outcome: 'home' | 'away' | 'draw';
};

type BetStatus = 'open' | 'won' | 'lost';

type PlacedBet = {
  row: number;
  targetTime: number;
  outcome: 'home' | 'away' | 'draw';
  status: BetStatus;
  multiplier: number;
};

type Props = {
  ticks: OddsTick[];
  matchId?: number;
  onBet: (square: GridSquare) => void;
  placedBets?: PlacedBet[];
  selectedOutcome: 'home' | 'away' | 'draw';
  hasBalance: boolean;
};

const SQUARE_INTERVAL_MS = 5000;
const DURATIONS = [30, 60, 120] as const;
const MIN_TIME_MS = 500;
const MAX_MULTIPLIER = 50;
const NUM_ROWS = 10;
const HOUSE_EDGE_K = 0.97;
const MIN_SIGMA0 = 1e-3;
const MIN_MULTIPLIER = 1.1;
const MIN_PROB = 1e-9;
// sigma(t) reaches this fraction of the visible padded price range by the far edge of the grid
const SIGMA_RANGE_FRACTION = 0.25;

// ── Helpers ─────────────────────────────────────────

/** Build an SVG path with rounded corners from an array of {x,y} points */
function buildPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  const radius = 20;
  let d = `M ${points[0].x} ${points[0].y} `;

  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];

    const d01 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const d12 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (d01 === 0 || d12 === 0) continue;

    const r = Math.min(radius, d01 / 2, d12 / 2);
    const cx1 = p1.x - (p1.x - p0.x) * (r / d01);
    const cy1 = p1.y - (p1.y - p0.y) * (r / d01);
    const cx2 = p1.x + (p2.x - p1.x) * (r / d12);
    const cy2 = p1.y + (p2.y - p1.y) * (r / d12);

    d += `L ${cx1} ${cy1} Q ${p1.x} ${p1.y}, ${cx2} ${cy2} `;
  }

  const last = points[points.length - 1];
  d += `L ${last.x} ${last.y}`;
  return d;
}

/** Abramowitz & Stegun 7.1.26 approximation of the error function (max abs error ~1.5e-7) */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

/** Standard normal CDF via erf */
function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/**
 * Volatility (sigma0) for a Brownian-motion price model, where sigma(t) = sigma0 * sqrt(t).
 * Calibrated from the grid's own visible geometry — the padded price range and the full
 * selected duration — rather than raw tick-to-tick deltas. Pre-match 1X2 odds barely move
 * between individual ticks, so a delta-based volatility estimate collapses to ~0 for a quiet
 * feed; scaling off the visible range instead guarantees sigma(t) is always sized relative to
 * the row band width, so the grid produces a real gradient instead of saturating at the
 * min/max clamps for the entire duration.
 */
function deriveSigma0(paddedRange: number, fullDurationMs: number): number {
  return Math.max((paddedRange * SIGMA_RANGE_FRACTION) / Math.sqrt(fullDurationMs), MIN_SIGMA0);
}

// ── Component ───────────────────────────────────────

export function OddsChart({ ticks, onBet, placedBets = [], selectedOutcome, hasBalance }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [durationSec, setDurationSec] = useState<typeof DURATIONS[number]>(60);
  const [hoveredSquare, setHoveredSquare] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 1000, height: 500 });
  const [smoothed, setSmoothed] = useState({ now: 0, minP: 0, maxP: 0 });
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Track offset ONLY when a new tick arrives
  const offsetRef = useRef<number | null>(null);
  const lastTickTsRef = useRef<number>(0);

  useEffect(() => {
    if (ticks.length > 0) {
      const lastTs = ticks[ticks.length - 1].ts;
      if (lastTs !== lastTickTsRef.current) {
        lastTickTsRef.current = lastTs;
        const newOffset = lastTs - Date.now();
        if (offsetRef.current === null) {
          offsetRef.current = newOffset;
        } else {
          // Blend offset slightly to account for network jitter
          offsetRef.current = offsetRef.current * 0.8 + newOffset * 0.2;
        }
      }
    }
  }, [ticks]);

  const targetsRef = useRef({ minP: 0, maxP: 100 });

  useEffect(() => {
    if (ticks.length === 0) return;
    const recentTicks = ticks.slice(-60);
    const allValues = recentTicks.flatMap((t) => [t.home, t.away, t.draw]);
    let minP = Math.min(...allValues);
    let maxP = Math.max(...allValues);
    const padding = Math.max(5, (maxP - minP) * 0.2);
    targetsRef.current = {
      minP: Math.max(0, minP - padding),
      maxP: Math.min(100, maxP + padding),
    };
  }, [ticks]);

  // Smoothed continuous animation loop
  useEffect(() => {
    if (ticks.length === 0) return;
    let animationFrameId: number;
    let currentMinP = 0;
    let currentMaxP = 100;

    const loop = () => {
      const t = targetsRef.current;
      const offset = offsetRef.current;
      
      if (offset !== null) {
        const localNow = Date.now();
        const now = localNow + offset;

        if (currentMinP === 0 && currentMaxP === 100 && t.minP !== 0) {
           currentMinP = t.minP;
           currentMaxP = t.maxP;
        } else {
           // Smoothly interpolate vertical scale
           currentMinP += (t.minP - currentMinP) * 0.1;
           currentMaxP += (t.maxP - currentMaxP) * 0.1;
        }
        
        setSmoothed({ now, minP: currentMinP, maxP: currentMaxP });
      }
      animationFrameId = requestAnimationFrame(loop);
    };

    animationFrameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationFrameId);
  }, [ticks.length > 0]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        setDimensions({
          width: entries[0].contentRect.width,
          height: entries[0].contentRect.height,
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // ── Derived data ─────────────────────────────────
  const computed = useMemo(() => {
    const yPad = 60;
    const ls = dimensions.width * 0.25;
    const rh = (dimensions.height - yPad * 2) / NUM_ROWS;
    const cw = rh;
    const pxPerMs = rh / SQUARE_INTERVAL_MS;

    const defaultRet = {
      selectedPath: '',
      gridSquares: [] as GridSquare[],
      currentPrice: 0,
      currentY: dimensions.height / 2,
      minPrice: 0,
      maxPrice: 100,
      timestamps: [] as number[],
      leftSection: ls,
      yPadding: yPad,
      rowHeight: rh,
      colWidth: cw,
      pixelsPerMs: pxPerMs,
    };

    const { now, minP, maxP } = smoothed;
    if (now === 0 || ticks.length === 0) return defaultRet;

    // Use the last 60 ticks
    const recentTicks = ticks.slice(-60);
    const lastTick = recentTicks[recentTicks.length - 1];

    const getY = (val: number) => {
      if (maxP === minP) return dimensions.height / 2;
      const ratio = (val - minP) / (maxP - minP);
      return dimensions.height - yPad - ratio * (dimensions.height - yPad * 2);
    };

    const getX = (ts: number) => ls + (ts - now) * pxPerMs;

    const selectedPrice = lastTick[selectedOutcome];
    const selectedPts: { x: number; y: number }[] = [];
    for (const t of recentTicks) {
      selectedPts.push({ x: getX(t.ts), y: getY(t[selectedOutcome]) });
    }
    // Extend the line smoothly to the live right edge
    selectedPts.push({ x: getX(now), y: getY(selectedPrice) });

    const numCols = Math.ceil((durationSec * 1000) / SQUARE_INTERVAL_MS) + 2;
    const band = (maxP - minP) / NUM_ROWS;
    const firstInterval = Math.ceil(now / SQUARE_INTERVAL_MS) * SQUARE_INTERVAL_MS;
    const tsList: number[] = [];
    const sigma0 = deriveSigma0(maxP - minP, durationSec * 1000);

    const squares: GridSquare[] = [];
    for (let c = 0; c < numCols; c++) {
      const targetTime = firstInterval + c * SQUARE_INTERVAL_MS;
      tsList.push(targetTime);

      const t = Math.max(targetTime - now, MIN_TIME_MS);
      const sigma = sigma0 * Math.sqrt(t);

      for (let r = 0; r < NUM_ROWS; r++) {
        const yMax = maxP - r * band;
        const yMin = maxP - (r + 1) * band;

        const zHi = (yMax - selectedPrice) / sigma;
        const zLo = (yMin - selectedPrice) / sigma;
        const p = Math.max(normalCdf(zHi) - normalCdf(zLo), MIN_PROB);

        let multiplier = HOUSE_EDGE_K / p;
        if (multiplier < MIN_MULTIPLIER) multiplier = MIN_MULTIPLIER;
        if (multiplier > MAX_MULTIPLIER) multiplier = MAX_MULTIPLIER;

        squares.push({ col: c, row: r, yMin, yMax, multiplier, targetTime, outcome: selectedOutcome });
      }
    }

    return {
      selectedPath: buildPath(selectedPts),
      gridSquares: squares,
      currentPrice: selectedPrice,
      currentY: getY(selectedPrice),
      minPrice: minP,
      maxPrice: maxP,
      timestamps: tsList,
      leftSection: ls,
      yPadding: yPad,
      rowHeight: rh,
      colWidth: cw,
      pixelsPerMs: pxPerMs,
    };
  }, [ticks, dimensions, smoothed, durationSec]);

  const {
    selectedPath,
    gridSquares,
    currentPrice,
    currentY,
    minPrice,
    maxPrice,
    timestamps,
    leftSection,
    yPadding,
    rowHeight,
    colWidth,
    pixelsPerMs,
  } = computed;

  const lineColor = selectedOutcome === 'home' ? '#00E676' : selectedOutcome === 'away' ? '#FF5252' : '#FFC107';
  const gridLineColor = 'rgba(233, 91, 140, 0.15)';
  const gridDotColor = '#C28B9F';
  const multColor = '#C28B9F';

  if (!isMounted) {
    return (
      <div
        ref={containerRef}
        className="w-full h-full absolute inset-0 bg-transparent font-sans select-none overflow-hidden"
      />
    );
  }

  const lastTick = ticks.length > 0 ? ticks[ticks.length - 1] : null;

  return (
    <div
      ref={containerRef}
      className="w-full h-full absolute inset-0 bg-transparent font-sans select-none overflow-hidden"
    >
      {/* Duration selector */}
      <div className="absolute top-4 left-4 z-20 flex gap-2">
        {DURATIONS.map((d) => (
          <button
            key={d}
            onClick={() => setDurationSec(d)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              durationSec === d
                ? 'bg-[#E95B8C] text-white'
                : 'bg-black/40 text-[#C28B9F] hover:bg-[#E95B8C]/20'
            }`}
          >
            {d}s
          </button>
        ))}
      </div>

      {/* ─── Live verification panel ─────────────── */}
      {lastTick && (
        <div className="absolute top-14 left-4 z-20 flex flex-col gap-1 bg-black/60 backdrop-blur-sm border border-white/10 rounded-xl px-4 py-3 font-mono text-xs">
          <div className="text-[#9C818C] mb-1 text-[10px] uppercase tracking-wider font-semibold">Live Odds</div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ background: '#00E676' }} />
            <span className="text-white/70">HOME</span>
            <span className="text-white font-bold ml-auto">{lastTick.home.toFixed(1)}%</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ background: '#FF5252' }} />
            <span className="text-white/70">AWAY</span>
            <span className="text-white font-bold ml-auto">{lastTick.away.toFixed(1)}%</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ background: '#FFC107' }} />
            <span className="text-white/70">DRAW</span>
            <span className="text-white font-bold ml-auto">{lastTick.draw.toFixed(1)}%</span>
          </div>
        </div>
      )}

      {/* ─── SVG Chart ───────────────────────────── */}
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
        className="block absolute inset-0"
      >
        <defs>
          <pattern
            id="dotPattern"
            x={-(smoothed.now * pixelsPerMs) % colWidth}
            y="0"
            width={colWidth}
            height={rowHeight}
            patternUnits="userSpaceOnUse"
          >
            <circle cx="2" cy="2" r="1.5" fill="rgba(233, 91, 140, 0.15)" />
          </pattern>

          <filter id="lineGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <filter id="dotGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>

          <linearGradient id="gridFadeGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#000" stopOpacity={0} />
            <stop offset="20%" stopColor="#fff" stopOpacity={1} />
            <stop offset="100%" stopColor="#fff" stopOpacity={1} />
          </linearGradient>
          <mask
            id="gridMask"
            maskUnits="userSpaceOnUse"
            x={leftSection}
            y="0"
            width={dimensions.width - leftSection}
            height={dimensions.height}
          >
            <rect
              x={leftSection}
              y="0"
              width={dimensions.width - leftSection}
              height={dimensions.height}
              fill="url(#gridFadeGrad)"
            />
          </mask>
        </defs>

        <rect x="0" y="0" width={dimensions.width} height={dimensions.height} fill="url(#dotPattern)" />

        <g mask="url(#gridMask)">
          {/* Horizontal grid lines */}
          {Array.from({ length: NUM_ROWS + 1 }).map((_, i) => {
            const y = yPadding + i * rowHeight;
            return (
              <line
                key={`hline-${i}`}
                x1={leftSection}
                y1={y}
                x2={dimensions.width}
                y2={y}
                stroke={gridLineColor}
                strokeWidth="1.5"
              />
            );
          })}

          {/* Vertical grid lines & dots */}
          {timestamps.map((ts) => {
            const x = leftSection + (ts - smoothed.now) * pixelsPerMs;
            if (x < leftSection) return null;
            return (
              <g key={`vline-${ts}`}>
                <line
                  x1={x}
                  y1={yPadding}
                  x2={x}
                  y2={dimensions.height - yPadding}
                  stroke={gridLineColor}
                  strokeWidth="1.5"
                />
                {Array.from({ length: NUM_ROWS + 1 }).map((_, r) => (
                  <circle
                    key={`dot-${ts}-${r}`}
                    cx={x}
                    cy={yPadding + r * rowHeight}
                    r="2.5"
                    fill={gridDotColor}
                    filter="url(#dotGlow)"
                  />
                ))}
              </g>
            );
          })}

          {/* Betting grid squares */}
          <g>
            {gridSquares.map((sq) => {
              const x =
                leftSection + (sq.targetTime - SQUARE_INTERVAL_MS - smoothed.now) * pixelsPerMs;
              if (x + colWidth <= leftSection) return null;

              const y1 = yPadding + sq.row * rowHeight;
              const isHovered = hoveredSquare === `${sq.targetTime}-${sq.row}`;
              const bet = placedBets.find(
                (b) => Math.abs(b.targetTime - sq.targetTime) < 1000 && b.row === sq.row && b.outcome === sq.outcome,
              );
              // Placed cells are rendered by the dedicated, unmasked layer below instead —
              // this live grid only ever shows the current/future clickable cells.
              if (bet) return null;

              const bgFill = isHovered ? 'rgba(233, 91, 140, 0.15)' : 'transparent';
              const txtColor = isHovered ? '#FFFFFF' : multColor;

              return (
                <g
                  key={`${sq.targetTime}-${sq.row}`}
                  onMouseEnter={() => setHoveredSquare(`${sq.targetTime}-${sq.row}`)}
                  onMouseLeave={() => setHoveredSquare(null)}
                  onClick={() => hasBalance && onBet(sq)}
                  className="cursor-pointer"
                >
                  <rect
                    x={x}
                    y={y1}
                    width={colWidth}
                    height={rowHeight}
                    fill={isHovered ? 'rgba(233, 91, 140, 0.2)' : 'transparent'}
                    stroke={isHovered ? '#E95B8C' : 'none'}
                    strokeWidth="1"
                  />
                  {isHovered ? (
                    <g>
                      <text
                        x={x + colWidth / 2}
                        y={y1 + rowHeight / 2 - 6}
                        fill="#FFFFFF"
                        fontSize="11"
                        fontWeight="600"
                        textAnchor="middle"
                        className="pointer-events-none"
                      >
                        0.001 SOL
                      </text>
                      <text
                        x={x + colWidth / 2}
                        y={y1 + rowHeight / 2 + 8}
                        fill="#E95B8C"
                        fontSize="13"
                        fontWeight="800"
                        textAnchor="middle"
                        className="pointer-events-none"
                      >
                        {sq.multiplier.toFixed(2)}x
                      </text>
                      <text
                        x={x + colWidth / 2}
                        y={y1 + rowHeight / 2 + 24}
                        fill={hasBalance ? '#00E676' : '#9C818C'}
                        fontSize="10"
                        fontWeight="700"
                        textAnchor="middle"
                        className="pointer-events-none"
                      >
                        {hasBalance ? 'BET' : 'NO BALANCE'}
                      </text>
                    </g>
                  ) : (
                    <text
                      x={x + colWidth / 2}
                      y={y1 + rowHeight / 2 + 4}
                      fill={multColor}
                      fontSize="13"
                      fontWeight="400"
                      textAnchor="middle"
                      className="pointer-events-none"
                    >
                      {sq.multiplier >= 100 ? '100x' : `${sq.multiplier.toFixed(2)}x`}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </g>

        {/* ─── Placed bet squares ──────────────────────
            Rendered outside the grid mask so a bet stays visible (and shows its
            won/lost resolution) after its column scrolls left of the live grid,
            instead of disappearing the instant its target time passes. */}
        <g>
          {placedBets.map((bet) => {
            const x = leftSection + (bet.targetTime - SQUARE_INTERVAL_MS - smoothed.now) * pixelsPerMs;
            if (x + colWidth <= 0) return null;

            const y1 = yPadding + bet.row * rowHeight;
            let bgFill = '#FFD700';
            let stroke = '#FFD700';
            let txtColor = '#000000';
            if (bet.status === 'won') {
              bgFill = 'rgba(0, 230, 118, 0.3)';
              stroke = 'rgba(0, 230, 118, 0.8)';
              txtColor = '#FFFFFF';
            } else if (bet.status === 'lost') {
              bgFill = 'rgba(255, 82, 82, 0.3)';
              stroke = 'rgba(255, 82, 82, 0.8)';
              txtColor = '#FFFFFF';
            }

            return (
              <g key={`bet-${bet.targetTime}-${bet.row}-${bet.outcome}`}>
                <rect x={x} y={y1} width={colWidth} height={rowHeight} fill={bgFill} stroke={stroke} strokeWidth="1" />
                <text
                  x={x + colWidth / 2}
                  y={y1 + rowHeight / 2 + 4}
                  fill={txtColor}
                  fontSize="15"
                  fontWeight="800"
                  textAnchor="middle"
                  className="pointer-events-none"
                >
                  {bet.multiplier >= 100 ? '100x' : `${bet.multiplier.toFixed(2)}x`}
                </text>
              </g>
            );
          })}
        </g>

        {/* ─── Selected outcome line ─────────────── */}
        {selectedPath && (
          <>
            <path
              d={selectedPath}
              fill="none"
              stroke={lineColor}
              strokeWidth="3"
              strokeOpacity="0.3"
              filter="url(#lineGlow)"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={selectedPath}
              fill="none"
              stroke={lineColor}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        )}

        {/* ─── Cursor dot at the live edge ───── */}
        {selectedPath && (
          <g transform={`translate(${leftSection}, ${currentY})`}>
            <circle cx="0" cy="0" r="16" fill={lineColor} opacity="0.2" filter="url(#lineGlow)">
              <animate attributeName="r" values="8;20;8" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.6;0;0.6" dur="2s" repeatCount="indefinite" />
            </circle>
            <circle cx="0" cy="0" r="5" fill={lineColor} filter="url(#lineGlow)" />
            <circle cx="0" cy="0" r="2.5" fill="#FFFFFF" />
          </g>
        )}
      </svg>

      {/* ─── Y-axis labels ───────────────────────── */}
      <div className="absolute right-0 top-0 bottom-0 w-[80px] pointer-events-none flex flex-col pt-[60px]">
        {Array.from({ length: NUM_ROWS + 1 }).map((_, i) => {
          const val = maxPrice - i * ((maxPrice - minPrice) / NUM_ROWS);
          return (
            <div
              key={`yval-${i}`}
              className="absolute right-4 text-xs font-mono text-[#9C818C]"
              style={{ top: yPadding + i * rowHeight - 8 }}
            >
              {val.toFixed(1)}%
            </div>
          );
        })}
      </div>

      {/* ─── Current value badge ────────────────── */}
      {currentPrice > 0 && (
        <div
          className="absolute px-2 py-0.5 rounded text-white font-mono text-xs shadow-lg z-10 pointer-events-none"
          style={{
            top: currentY - 10,
            left: leftSection + 16,
            background: lineColor,
          }}
        >
          {currentPrice.toFixed(1)}%
        </div>
      )}

      {/* ─── X-axis time labels ──────────────────── */}
      <div
        className="absolute bottom-0 h-[60px] pointer-events-none overflow-hidden"
        style={{
          left: leftSection,
          right: 0,
          WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 20%)',
        }}
      >
        {timestamps.map((ts) => {
          const x = (ts - smoothed.now) * pixelsPerMs;
          const d = new Date(ts);
          const timeStr = d.toLocaleTimeString('en-US', {
            hour12: true,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          });
          if (x < 0) return null;
          return (
            <div
              key={`ts-${ts}`}
              className="absolute text-xs font-mono text-[#9C818C] -translate-x-1/2 mt-4 whitespace-nowrap"
              style={{ left: x }}
            >
              {timeStr}
            </div>
          );
        })}
      </div>
    </div>
  );
}
