import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import axios, { type AxiosInstance } from 'axios';
import nacl from 'tweetnacl';
import { TXLINE_API_BASE_URL, TXLINE_PROGRAM_ID, TXL_MINT } from './config.js';

const programId = new PublicKey(TXLINE_PROGRAM_ID);
const tokenMint = new PublicKey(TXL_MINT);

export function loadWallet(): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.WALLET_SECRET_KEY!)));
}

// ponytail: borsh-encode subscribe(service_level_id: u16, weeks: u8)
function encodeSubscribeIx(serviceLevelId: number, weeks: number): Buffer {
  const buf = Buffer.alloc(11);
  Buffer.from([254, 28, 191, 138, 156, 179, 183, 53]).copy(buf, 0); // discriminator
  buf.writeUInt16LE(serviceLevelId, 8);
  buf.writeUInt8(weeks, 10);
  return buf;
}

export async function setupTxline(): Promise<{ wallet: Keypair; apiToken: string; jwt: string; axios: AxiosInstance }> {
  const wallet = loadWallet();
  const connection = new Connection(process.env.ANCHOR_PROVIDER_URL ?? 'https://api.devnet.solana.com', 'confirmed');

  const jwtRes = await axios.post(`${TXLINE_API_BASE_URL.replace('/api', '')}/auth/guest/start`);
  const jwt: string = jwtRes.data.token;

  const userTokenAccountAddress = getAssociatedTokenAddressSync(tokenMint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const accountInfo = await connection.getAccountInfo(userTokenAccountAddress);

  if (!accountInfo) {
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey, userTokenAccountAddress, wallet.publicKey,
        tokenMint, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
      )
    );
    await sendAndConfirmTransaction(connection, tx, [wallet]);
  }

  await getAccount(connection, userTokenAccountAddress, 'confirmed', TOKEN_2022_PROGRAM_ID);

  const [pricingMatrixPda] = PublicKey.findProgramAddressSync([Buffer.from('pricing_matrix')], programId);
  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync([Buffer.from('token_treasury_v2')], programId);
  const tokenTreasuryVault = getAssociatedTokenAddressSync(tokenMint, tokenTreasuryPda, true, TOKEN_2022_PROGRAM_ID);

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: pricingMatrixPda, isSigner: false, isWritable: false },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: userTokenAccountAddress, isSigner: false, isWritable: true },
      { pubkey: tokenTreasuryVault, isSigner: false, isWritable: true },
      { pubkey: tokenTreasuryPda, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: PublicKey.default, isSigner: false, isWritable: false }, // system_program
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId,
    data: encodeSubscribeIx(1, 4),
  });

  const tx = new Transaction().add(ix);
  const latestBlockhash = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = latestBlockhash.blockhash;
  tx.feePayer = wallet.publicKey;
  tx.sign(wallet);

  const txSig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({ signature: txSig, ...latestBlockhash }, 'confirmed');
  console.log('[txline] subscribed:', txSig);

  const messageString = `${txSig}::${jwt}`;
  const signatureBytes = nacl.sign.detached(new TextEncoder().encode(messageString), wallet.secretKey);
  const walletSignature = Buffer.from(signatureBytes).toString('base64');

  const activationRes = await axios.post(
    `${TXLINE_API_BASE_URL}/token/activate`,
    { txSig, walletSignature, leagues: [] },
    { headers: { Authorization: `Bearer ${jwt}` } },
  );
  const apiToken: string = activationRes.data.token ?? activationRes.data;

  const client = axios.create({
    baseURL: TXLINE_API_BASE_URL,
    headers: { Authorization: `Bearer ${jwt}`, 'X-Api-Token': apiToken },
  });

  return { wallet, apiToken, jwt, axios: client };
}
