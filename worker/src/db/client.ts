import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/config";
import * as schema from "@/db/schema";

const isLocal = /@(localhost|127\.0\.0\.1)/.test(env.DATABASE_URL);

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
  keepAlive: true,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  maxLifetimeSeconds: 240,
});

pool.on("error", (err) => {
  console.error("[db] idle pool client error (recovering):", err.message);
});

export const db = drizzle(pool, { schema });
