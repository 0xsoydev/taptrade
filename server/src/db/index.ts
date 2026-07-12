import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema.js';

const client = createClient({ url: process.env.DATABASE_URL ?? 'file:./txodds-tap.db' });
export const db = drizzle(client, { schema });
