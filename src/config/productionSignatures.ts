/**
 * Signatures of RAZEEN Production. If any of these is observed in a running
 * staging build, the environment guard halts the app.
 *
 * Only NON-SECRET identifiers belong here — refs, domains and public analytics
 * IDs that already ship in the production browser bundle. Never put a secret in
 * this file: it is committed, and a leaked key is a worse outcome than a missed
 * signature. Secrets are caught by shape, not by value (see envGuard.ts).
 */

/** Supabase project ref that holds real orders and customers. */
export const PRODUCTION_SUPABASE_REF = "bpdqgiytpmiagbzplrhz";

/** Hosts that serve, or resolve to, the live store. */
export const PRODUCTION_HOSTS = [
  "byrazeen.com",
  "www.byrazeen.com",
  "razeen-scent-identity.lovable.app",
] as const;

/** Public measurement IDs. Sending staging traffic to these poisons real campaign data. */
export const PRODUCTION_MEASUREMENT_IDS = [
  "778889951551824",      // Meta Pixel
  "G-RCB5KWLLFN",         // GA4
  "D9D4SHJC77UBUU504H9G", // TikTok Pixel
] as const;

/** Live third-party API hosts. Staging must reach a sandbox or nothing at all. */
export const PRODUCTION_SERVICE_HOSTS = [
  "api-v2.ziina.com",
  "api.tabby.ai",
  "api.wasenderapi.com",
  "app.wasender.net",
  "www.wasenderapi.com",
] as const;

/** Every signature as one flat list, for substring scanning of env values. */
export const ALL_PRODUCTION_SIGNATURES: readonly string[] = [
  PRODUCTION_SUPABASE_REF,
  ...PRODUCTION_HOSTS,
  ...PRODUCTION_MEASUREMENT_IDS,
  ...PRODUCTION_SERVICE_HOSTS,
];
