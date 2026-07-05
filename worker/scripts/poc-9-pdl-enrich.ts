// POC: People Data Labs Person Enrichment, compared against the web-search-only
// approach in poc-8-person.ts. Hits the sandbox endpoint first (free, synthetic
// data — proves the request/response shape without spending real credits), then
// the production endpoint against the real email.
//   PDL_API_KEY=... npx tsx scripts/poc-9-pdl-enrich.ts "Aditya Agarwal" "aditya.agarwal@stepsai.ca"

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

function writeJson(name: string, data: unknown): string {
  const outDir = join(HERE, "output");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, name);
  writeFileSync(outPath, JSON.stringify(data, null, 2));
  return outPath;
}

const name = process.argv[2] ?? "Aditya Agarwal";
const email = process.argv[3] ?? "aditya.agarwal@stepsai.ca";
const apiKey = process.env.PDL_API_KEY;
if (!apiKey) {
  console.error("Missing PDL_API_KEY env var.");
  process.exit(1);
}

async function enrich(base: string, params: Record<string, string>): Promise<{ status: number; body: any }> {
  const qs = new URLSearchParams({ ...params, api_key: apiKey! }).toString();
  const res = await fetch(`${base}/v5/person/enrich?${qs}`, { signal: AbortSignal.timeout(30000) });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

const domain = email.split("@")[1]?.toLowerCase() ?? "";
const companyGuess = domain.split(".")[0] ?? "";

async function main() {
  console.log(`\nPerson: ${name}\nEmail: ${email}\nDomain: ${domain}\n`);

  // Sandbox sanity check: confirms the key authenticates before spending real credits.
  console.log("=== Sandbox endpoint — auth/shape check (documented example profile) ===");
  const sandbox = await enrich("https://sandbox.api.peopledatalabs.com", {
    profile: "linkedin.com/in/seanthorne",
  });
  console.log(`Status: ${sandbox.status}${sandbox.status === 200 ? " (key valid, sandbox dataset has this record)" : " (this account's sandbox dataset doesn't include this record — not fatal)"}`);

  // Tier 1a: enrich by email — cheapest, most direct, but only works if PDL has
  // this exact email indexed against a profile (rare for smaller companies).
  console.log("\n=== Production — enrich by email ===");
  const byEmail = await enrich("https://api.peopledatalabs.com", { email });
  console.log(`Status: ${byEmail.status}  likelihood: ${byEmail.body?.likelihood ?? "n/a"}`);
  if (byEmail.status !== 200) console.log(`  ${JSON.stringify(byEmail.body)}`);

  // Tier 1b fallback: enrich by name + company derived from the email domain.
  // PDL's own identity graph (LinkedIn + company data) disambiguates common names
  // far better than raw web search — this is the whole point of the tier.
  console.log("\n=== Production — enrich by name + company (fallback) ===");
  const byNameCompany = await enrich("https://api.peopledatalabs.com", { name, company: companyGuess });
  console.log(`Status: ${byNameCompany.status}  likelihood: ${byNameCompany.body?.likelihood ?? "n/a"}`);
  if (byNameCompany.status === 200) {
    const d = byNameCompany.body.data;
    console.log(`  MATCH: ${d.full_name} — ${d.job_title} @ ${d.job_company_name} (${d.job_company_website})`);
    console.log(`  LinkedIn: ${d.linkedin_url}`);
    console.log(`  Location: ${d.location_name ? `${d.location_names?.[0] ?? "?"}, ${d.countries?.[0] ?? "?"}` : "unknown"}`);
    console.log(`  Skills: ${(d.skills ?? []).slice(0, 6).join(", ")}`);
  } else {
    console.log(`  ${JSON.stringify(byNameCompany.body)}`);
  }

  const out = writeJson("poc-9-pdl-enrich.json", {
    meta: { name, email, domain, companyGuess, generatedAt: new Date().toISOString() },
    sandboxAuthCheck: sandbox,
    byEmail,
    byNameCompany,
  });
  console.log(`\nWrote ${out}`);
}

main().catch((e) => (console.error(e), process.exit(1)));
