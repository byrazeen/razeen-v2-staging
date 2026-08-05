/** Bundles the TypeScript guard so the plain-node test suites can import it. */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
const root = new URL("..", import.meta.url).pathname;
mkdirSync(root + ".build", { recursive: true });
execFileSync(root + "node_modules/.bin/esbuild", [
  root + "src/config/envGuard.ts",
  "--bundle", "--format=esm", "--log-level=error",
  "--outfile=" + root + ".build/envGuard.mjs",
], { stdio: "inherit" });
