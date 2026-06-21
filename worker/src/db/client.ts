import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/config";
import * as schema from "@/db/schema";

// Managed Postgres (Neon, etc.) requires TLS; local dev usually doesn't.
const isLocal = /@(localhost|127\.0\.0\.1)/.test(env.DATABASE_URL);

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
});

export const db = drizzle(pool, { schema });
