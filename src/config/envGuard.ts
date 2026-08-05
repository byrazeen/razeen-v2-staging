/**
 * RAZEEN V2 STAGING — environment guard.
 *
 * Fails closed. The app must not boot unless it can prove it is talking to
 * staging and nothing else. A guard that merely warns is not a guard: the whole
 * point is that a mistake stops the build instead of reaching a real customer.
 *
 * Two independent checks, because either alone is escapable:
 *   1. Nothing that looks like production may appear in ANY env value.
 *   2. Staging's own markers must be present and correct.
 */
import { ALL_PRODUCTION_SIGNATURES, PRODUCTION_SUPABASE_REF } from "./productionSignatures";

export class ProductionContactError extends Error {
  readonly violations: string[];
  constructor(violations: string[]) {
    super(
      "RAZEEN V2 STAGING halted: production resources detected.\n" +
        violations.map((v) => `  • ${v}`).join("\n") +
        "\nStaging must never connect to RAZEEN Production."
    );
    this.name = "ProductionContactError";
    this.violations = violations;
  }
}

/** Env vars staging cannot run without. Absence means "misconfigured", which we treat as unsafe. */
const REQUIRED_STAGING_VARS = [
  "VITE_APP_ENV",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PROJECT_ID",
] as const;

/** Adapters that must be inert in staging. Anything but these values is a violation. */
const INERT_ADAPTER_MODES = ["mock", "sandbox", "disabled"] as const;
const ADAPTER_MODE_VARS = [
  "VITE_PAYMENT_MODE",
  "VITE_MESSAGING_MODE",
  "VITE_EMAIL_MODE",
  "VITE_SHIPPING_MODE",
  "VITE_ANALYTICS_MODE",
] as const;

export interface GuardInput {
  env: Record<string, string | undefined>;
  /** Browser host, when running in one. */
  host?: string;
}

/**
 * Returns every reason this environment is unsafe. Empty array means safe.
 * Collecting all violations rather than throwing on the first one means a
 * misconfigured setup is fixed in a single pass.
 */
export function findViolations({ env, host }: GuardInput): string[] {
  const violations: string[] = [];

  // 1 — production signatures anywhere in the environment
  for (const [key, rawValue] of Object.entries(env)) {
    if (typeof rawValue !== "string" || rawValue.length === 0) continue;
    const value = rawValue.toLowerCase();
    for (const signature of ALL_PRODUCTION_SIGNATURES) {
      if (value.includes(signature.toLowerCase())) {
        violations.push(`${key} contains a production signature ("${signature}")`);
      }
    }
  }

  // 2 — serving from a production host
  if (host) {
    const h = host.toLowerCase();
    for (const signature of ALL_PRODUCTION_SIGNATURES) {
      if (h === signature.toLowerCase() || h.endsWith(`.${signature.toLowerCase()}`)) {
        violations.push(`app is being served from production host "${host}"`);
      }
    }
  }

  // 3 — staging must declare itself
  if (env.VITE_APP_ENV !== "staging") {
    violations.push(`VITE_APP_ENV must be "staging" (got ${JSON.stringify(env.VITE_APP_ENV ?? null)})`);
  }

  // 4 — required config present
  for (const key of REQUIRED_STAGING_VARS) {
    if (!env[key]) violations.push(`required staging variable ${key} is missing`);
  }

  // 5 — the staging project must not be the production project
  if (env.VITE_SUPABASE_PROJECT_ID && env.VITE_SUPABASE_PROJECT_ID === PRODUCTION_SUPABASE_REF) {
    violations.push("VITE_SUPABASE_PROJECT_ID is the production project ref");
  }

  // 6 — every outward adapter inert
  for (const key of ADAPTER_MODE_VARS) {
    const mode = env[key];
    if (!mode) {
      violations.push(`${key} is missing — outward services must be explicitly inert in staging`);
    } else if (!INERT_ADAPTER_MODES.includes(mode as (typeof INERT_ADAPTER_MODES)[number])) {
      violations.push(`${key}="${mode}" is not inert (allowed: ${INERT_ADAPTER_MODES.join(", ")})`);
    }
  }

  return violations;
}

/** Throws unless the environment is provably staging. Call before the app renders. */
export function assertStagingEnvironment(input: GuardInput): void {
  const violations = findViolations(input);
  if (violations.length > 0) throw new ProductionContactError(violations);
}
