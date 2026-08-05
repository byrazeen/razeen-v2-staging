/**
 * فحص مراجع الإنتاج — production reference scan.
 *
 * يمنع تسرّب أي معرّف إنتاجي إلى شيفرة staging.
 *
 * القاعدة: معرّفات الإنتاج مسموحة في ملفات محدودة ومبرَّرة فقط — قائمة الحظر
 * نفسها، والاختبارات التي تحقن القيم عمداً، والوثائق التي تصف الإنتاج. أي ظهور
 * خارج هذه القائمة خطأ، ولو بدا بريئاً: مرجع إنتاج في شيفرة التطبيق هو أول خطوة
 * نحو اتصال حقيقي.
 *
 * القائمة تُوسَّع بقرار واعٍ لا بالصدفة — إضافة ملف هنا تظهر في الـdiff وتُراجَع.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

/** كل ملف هنا يحمل سبباً صريحاً لوجوده. لا تُضف ملفاً بلا سبب. */
const ALLOWED = new Map([
  ["src/config/productionSignatures.ts", "قائمة الحظر نفسها — الحارس لا يعمل بدونها"],
  ["tests/guard.negative.mjs", "يحقن قيم الإنتاج عمداً ليثبت أن الحارس يرفضها"],
  ["tests/prod-reference-scan.mjs", "هذا الملف — يحمل الأنماط التي يبحث عنها"],
  ["README.md", "وثيقة تشرح حدود العزل"],
  [".env.example", "يوضّح أي قيمة ممنوعة"],
  ["docs/RAZEEN_V2_PRODUCT_BLUEPRINT.md", "وثيقة مرجعية تصف نظام الإنتاج"],
  ["docs/RAZEEN_V2_ENVIRONMENT_VERIFICATION.md", "وثيقة مرجعية تصف نظام الإنتاج"],
]);

/**
 * تُقرأ من قائمة الحظر بدل تكرارها، حتى لا ينحرف الفحص عن الحارس.
 * أي توقيع يُضاف هناك يُفحص هنا تلقائياً.
 */
function productionSignatures() {
  const source = readFileSync("src/config/productionSignatures.ts", "utf8");
  const values = [...source.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  // نستبعد الأسطر الوصفية القصيرة؛ التوقيعات الحقيقية معرّفات أو نطاقات.
  return values.filter((v) => v.length >= 8 && !v.includes(" "));
}

function trackedFiles() {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

/** ملفات ثنائية لا معنى لفحصها نصياً. */
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|pdf|zip)$/i;

const signatures = productionSignatures();
const violations = [];

for (const file of trackedFiles()) {
  if (ALLOWED.has(file) || BINARY.test(file)) continue;
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue; // ملف غير قابل للقراءة نصياً
  }
  const lower = content.toLowerCase();
  for (const signature of signatures) {
    if (lower.includes(signature.toLowerCase())) {
      const line = content.split("\n").findIndex((l) => l.toLowerCase().includes(signature.toLowerCase())) + 1;
      violations.push(`${file}:${line} يحتوي معرّف إنتاج "${signature}"`);
    }
  }
}

console.log(`\n— فحص مراجع الإنتاج (${signatures.length} توقيعاً على ${trackedFiles().length} ملفاً) —`);
if (violations.length === 0) {
  console.log("  ✅ لا مرجع إنتاج خارج القائمة المبرَّرة");
  console.log("\n✅ الفحص نجح");
  process.exit(0);
}
for (const v of violations) console.log(`  ❌ ${v}`);
console.log(`\n❌ ${violations.length} مخالفة — معرّف إنتاج ظهر في ملف غير مبرَّر.`);
console.log("   إن كان الظهور مقصوداً وآمناً، أضف الملف إلى ALLOWED في هذا الفحص بسبب مكتوب.");
process.exit(1);
