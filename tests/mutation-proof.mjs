/**
 * Proof that guard.negative.mjs can actually fail.
 *
 * Replaces the guard with a stub that approves everything, re-runs the suite,
 * and demands a non-zero exit. A suite that stays green against a disabled
 * guard is decoration, and this script exits 1 to say so.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";

const BUILT = new URL("../.build/envGuard.mjs", import.meta.url).pathname;
const BACKUP = BUILT + ".real";
const SUITE = new URL("./guard.negative.mjs", import.meta.url).pathname;

const run = () => {
  try {
    execFileSync(process.execPath, [SUITE], { stdio: "pipe" });
    return 0;
  } catch (e) { return e.status ?? 1; }
};

console.log("١) الحارس الحقيقي مركّب:");
const real = run();
console.log(`   خروج = ${real} ${real === 0 ? "(أخضر ✅)" : "(أحمر ❌)"}`);

copyFileSync(BUILT, BACKUP);
const original = readFileSync(BUILT, "utf8");
// Neuter: approve every environment.
writeFileSync(BUILT, original.replace(
  /export\s*{[\s\S]*?};?\s*$/,
  "function __neutered() { return []; }\nexport { __neutered as findViolations };\n"
));

console.log("\n٢) الحارس مُعطَّل (يوافق على كل شيء):");
const mutated = run();
console.log(`   خروج = ${mutated} ${mutated !== 0 ? "(أحمر ✅ — الاختبار كشف التعطيل)" : "(أخضر ❌ — الاختبار بلا قيمة)"}`);

copyFileSync(BACKUP, BUILT);
console.log("\n٣) أُعيد الحارس الحقيقي:");
const restored = run();
console.log(`   خروج = ${restored} ${restored === 0 ? "(أخضر ✅)" : "(أحمر ❌)"}`);

const ok = real === 0 && mutated !== 0 && restored === 0;
console.log(`\n${ok ? "✅ الاختبار مُثبَت: ينجح مع الحارس، ويفشل بدونه." : "❌ الاختبار لا يثبت شيئاً."}`);
process.exit(ok ? 0 : 1);
