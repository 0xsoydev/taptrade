'use client';

import dynamic from 'next/dynamic';

export const WalletButton = dynamic(
  () => import('@solana/wallet-adapter-react-ui').then((mod) => mod.WalletMultiButton),
  { ssr: false }
);
