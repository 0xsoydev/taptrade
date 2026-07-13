import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { setDefaultResultOrder } from 'dns';
import * as schema from './schema.js';

setDefaultResultOrder('ipv4first');

const client = postgres(process.env.DATABASE_URL!);
export const db = drizzle(client, { schema });
