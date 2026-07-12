import 'dotenv/config';
import { setupTxline } from './txline/subscribe.js';

async function main() {
  const { axios: client } = await setupTxline();
  const res = await client.get('/odds/snapshot/18237038');
  console.log(JSON.stringify(res.data).substring(0, 500));
  process.exit(0);
}

main().catch(console.error);
