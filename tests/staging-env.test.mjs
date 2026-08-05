/**
 * القيم الافتراضية لا تُضعف الحارس في البناء المنشور.
 *
 * `stagingEnv.ts` يملأ قيم إعداد افتراضية ليقلع التطبيق محلياً بلا ملف بيئة.
 * وهذه راحة مشروعة، لكنها تلامس فحصاً من فحوص الحارس: أن غياب الإعداد نفسه
 * حالة غير آمنة. لو سرت الافتراضيات في النشرة لصار ذلك الفحص ميتاً — نشرةٌ بلا
 * إعداد تُقلع نحو مشروع وهمي بدل أن تتوقف.
 *
 * الاختبارات الأخرى لا تمسك هذا: كلها تستدعي `findViolations` ببيئة صريحة،
 * فلا ترى طبقة الافتراضيات إطلاقاً. هذا الملف يسدّ تلك الفجوة تحديداً.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
mkdirSync(root + ".build", { recursive: true });
execFileSync(root + "node_modules/.bin/esbuild", [
  root + "src/config/stagingEnv.ts",
  "--bundle", "--format=esm", "--log-level=error",
  // import.meta.env غير موجود خارج Vite؛ نستبدله بكائن فارغ لأن الدالة النقية
  // هي المقصودة بالفحص، وتأخذ البيئة والوضع كوسيطين صريحين.
  "--define:import.meta.env={}",
  "--outfile=" + root + ".build/stagingEnv.mjs",
], { stdio: "inherit" });

execFileSync(root + "node_modules/.bin/esbuild", [
  root + "src/config/envGuard.ts",
  "--bundle", "--format=esm", "--log-level=error",
  "--outfile=" + root + ".build/envGuard.mjs",
], { stdio: "inherit" });

const { resolveStagingEnv } = await import(root + ".build/stagingEnv.mjs");
const { findViolations } = await import(root + ".build/envGuard.mjs");

let failures = 0;
const check = (name, cond) => {
  console.log((cond ? "  ✅ " : "  ❌ ") + name);
  if (!cond) failures++;
};

const DEV = true;
const BUILD = false;

console.log("\n— خادم التطوير: الافتراضيات تعمل —");
{
  const env = resolveStagingEnv({}, DEV);
  check("بيئة فارغة تُملأ افتراضياً", Object.keys(env).length > 0);
  check("ولا مخالفة تمنع الإقلاع محلياً", findViolations({ env }).length === 0);
}

console.log("\n— البناء المنشور: لا افتراضيات، والغياب يوقف التطبيق —");
{
  const env = resolveStagingEnv({}, BUILD);
  check("بيئة فارغة تبقى فارغة", Object.keys(env).length === 0);
  const v = findViolations({ env });
  check("الحارس يوقف التطبيق", v.length > 0);
  check("ويسمّي المتغيّر الناقص VITE_SUPABASE_URL",
    v.some((x) => x.includes("VITE_SUPABASE_URL")));
  check("ويسمّي VITE_SUPABASE_PROJECT_ID",
    v.some((x) => x.includes("VITE_SUPABASE_PROJECT_ID")));
  check("ويعترض على غياب أوضاع المحوّلات",
    v.some((x) => x.includes("VITE_PAYMENT_MODE")));
}

console.log("\n— نشرة ناقصة جزئياً: النقص يُكتشف ولا يُغطّى —");
{
  const env = resolveStagingEnv({ VITE_APP_ENV: "staging" }, BUILD);
  check("متغيّر واحد لا يكفي", findViolations({ env }).length > 0);
  check("ولا تُحشى البقية من الافتراضيات", env.VITE_SUPABASE_URL === undefined);
}

console.log("\n— الأولوية للقيم الحقيقية في الوضعين —");
for (const [label, dev] of [["التطوير", DEV], ["البناء", BUILD]]) {
  const env = resolveStagingEnv({ VITE_SUPABASE_PROJECT_ID: "bpdqgiytpmiagbzplrhz" }, dev);
  check(`${label}: قيمة الإنتاج لا يطمسها الافتراضي`,
    env.VITE_SUPABASE_PROJECT_ID === "bpdqgiytpmiagbzplrhz");
  check(`${label}: والحارس يرفضها`, findViolations({ env }).length > 0);
}

console.log("\n— السلسلة الفارغة ليست إعداداً —");
{
  const env = resolveStagingEnv({ VITE_SUPABASE_URL: "" }, BUILD);
  check("قيمة فارغة تُعامَل كغائبة",
    findViolations({ env }).some((x) => x.includes("VITE_SUPABASE_URL")));
}

console.log(failures === 0 ? "\n✅ الافتراضيات محصورة في التطوير ولا تُضعف النشرة" : `\n❌ ${failures} مخالفة`);
process.exit(failures === 0 ? 0 : 1);
