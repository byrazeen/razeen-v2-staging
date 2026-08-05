/**
 * فحص الأسرار — secret scan.
 *
 * يُمسك السرّ بشكله لا بقيمته: لا يمكن سرد المفاتيح المحظورة مسبقاً، لكن يمكن
 * التعرّف على بنيتها. لذلك نفحص أنماطاً (JWT، مفاتيح دفع حية، مفاتيح خاصة)
 * ونمنع أي ملف بيئة متتبَّع.
 *
 * الفحص متعمّد التشدد: نتيجة إيجابية خاطئة تكلّف دقيقة، وسرّ مُسرَّب يكلّف
 * تدوير كل المفاتيح.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const PATTERNS = [
  { name: "JWT (مفتاح Supabase أو ما شابه)", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "Supabase service_role key", re: /service_role["'\s:=]+[A-Za-z0-9._-]{20,}/i },
  { name: "مفتاح Stripe حي", re: /\b(sk|rk)_live_[A-Za-z0-9]{16,}/ },
  { name: "مفتاح Stripe عام حي", re: /\bpk_live_[A-Za-z0-9]{16,}/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "OpenAI/Anthropic key", re: /\b(sk-ant-|sk-proj-)[A-Za-z0-9_-]{20,}/ },
  { name: "مفتاح خاص (PEM)", re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
];

/** ملفات البيئة ممنوعة في Git مهما كان محتواها — .env.example وحده مستثنى. */
const ENV_FILE = /(^|\/)\.env(\.|$)/;
const ENV_ALLOWED = new Set([".env.example"]);

const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|pdf|zip)$/i;

/**
 * أنماط تُطابق شكل السرّ لكنها ليست سرّاً — مثال في وثيقة أو قيمة وهمية في
 * اختبار. تُستثنى بملفها وسطرها معاً حتى لا يصير الاستثناء بوابة مفتوحة.
 */
const KNOWN_FALSE_POSITIVES = new Set([
  // (file, patternName) — تُملأ عند الحاجة بقرار واعٍ
]);

const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
const violations = [];

for (const file of files) {
  if (ENV_FILE.test(file) && !ENV_ALLOWED.has(file)) {
    violations.push(`${file} — ملف بيئة متتبَّع في Git (ممنوع؛ استخدم .env.local غير المتتبَّع)`);
    continue;
  }
  if (BINARY.test(file)) continue;

  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const lines = content.split("\n");
  for (const { name, re } of PATTERNS) {
    if (KNOWN_FALSE_POSITIVES.has(`${file}|${name}`)) continue;
    const index = lines.findIndex((l) => re.test(l));
    if (index !== -1) violations.push(`${file}:${index + 1} — يطابق نمط ${name}`);
  }
}

console.log(`\n— فحص الأسرار (${PATTERNS.length} نمطاً على ${files.length} ملفاً) —`);
if (violations.length === 0) {
  console.log("  ✅ لا سرّ ولا ملف بيئة متتبَّع");
  console.log("\n✅ الفحص نجح");
  process.exit(0);
}
for (const v of violations) console.log(`  ❌ ${v}`);
console.log(`\n❌ ${violations.length} مخالفة — سرّ محتمل داخل المستودع.`);
console.log("   لا تحذف السطر فقط: أي سرّ وصل إلى Git يجب اعتباره مكشوفاً وتدويره.");
process.exit(1);
