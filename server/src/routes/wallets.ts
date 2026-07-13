import { Router } from 'express';
import { Connection } from '@solana/web3.js';
import { deriveAbstractedKeypair } from '../wallet.js';

const connection = new Connection(process.env.ANCHOR_PROVIDER_URL ?? 'https://api.devnet.solana.com', 'confirmed');
const router = Router();

// GET /wallets/:externalPubkey — returns derived address + SOL balance
router.get('/:externalPubkey', async (req, res) => {
  try {
    const keypair = deriveAbstractedKeypair(req.params.externalPubkey);
    const balance = await connection.getBalance(keypair.publicKey);
    res.json({
      abstractedAddress: keypair.publicKey.toBase58(),
      balanceLamports: balance,
      balanceSol: balance / 1e9,
    });
  } catch {
    res.status(400).json({ error: 'invalid wallet' });
  }
});

export default router;
