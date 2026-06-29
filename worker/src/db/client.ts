import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/config";
import * as schema from "@/db/schema";

// Managed Postgres (Neon, etc.) requires TLS; local dev usually doesn't.
const isLocal = /@(localhost|127\.0\.0\.1)/.test(env.DATABASE_URL);

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
  // Long research runs leave the pool idle for minutes between writes, so
  // managed Postgres (Neon) drops connections. keepAlive holds the TCP open,
  // and maxLifetime/idle recycling discards connections before the server does.
  keepAlive: true,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  maxLifetimeSeconds: 240,
});

// A dropped idle client emits 'error' on the pool; with no handler Node crashes
// the entire task. Swallow it — the pool discards the dead client and opens a
// fresh one on the next query.
pool.on("error", (err) => {
  console.error("[db] idle pool client error (recovering):", err.message);
});

export const db = drizzle(pool, { schema });
