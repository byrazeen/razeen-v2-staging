/**
 * إثبات الحقن — يفشل الـCI عند حقن أي قيمة إنتاج.
 *
 * `guard.negative.mjs` يختبر دالة الحارس وحدها. هذا الملف أعلى منها: يبني
 * سجلّ المحوّلات الحقيقي — الطبقة التي يستوردها التطبيق فعلاً — ويثبت أن حقن
 * قيمة إنتاج يمنع الحصول على أي محوّل، لا أن يُسجَّل تحذير فقط.
 *
 * الفرق مهم: حارس يعمل في الاختبار لكن لا يُستدعى في مسار التطبيق حارسٌ اسماً
 * لا فعلاً.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
mkdirSync(root + ".build", { recursive: true });
execFileSync(root + "node_modules/.bin/esbuild", [
  root + "src/adapters/index.ts",
  "--bundle", "--format=esm", "--log-level=error",
  "--outfile=" + root + ".build/adapters.mjs",
], { stdio: "inherit" });

const { resolveAdapters } = await import(root + ".build/adapters.mjs");

const STAGING = {
  VITE_APP_ENV: "staging",
  VITE_SUPABASE_URL: "https://stgrazeenv2abcdefgh.supabase.co",
  VITE_SUPABASE_PROJECT_ID: "stgrazeenv2abcdefgh",
  VITE_PAYMENT_MODE: "mock",
  VITE_MESSAGING_MODE: "mock",
  VITE_EMAIL_MODE: "disabled",
  VITE_SHIPPING_MODE: "mock",
  VITE_ANALYTICS_MODE: "disabled",
};

let failures = 0;
const check = (name, cond) => {
  console.log((cond ? "  ✅ " : "  ❌ ") + name);
  if (!cond) failures++;
};

/** يرمي؟ نحتاج الرفض أن يكون منع وصول، لا مجرد قيمة راجعة. */
const rejects = (env, host) => {
  try {
    resolveAdapters(env, host);
    return false;
  } catch {
    return true;
  }
};

console.log("\n— سجلّ المحوّلات الحقيقي —");
let adapters = null;
try {
  adapters = resolveAdapters(STAGING, "razeen-v2-staging.lovable.app");
} catch (e) {
  console.log("  (فشل غير متوقع: " + e.message + ")");
}
check("تكوين staging سليم يُنتج محوّلات", adapters !== null);
check("كل المحوّلات غير حقيقية (mock/sandbox/disabled)",
  adapters !== null &&
    ["payment", "messaging", "email", "shipping", "analytics"].every(
      (k) => adapters[k] && ["mock", "sandbox", "disabled"].includes(adapters[k].mode)
    ));

console.log("\n— حقن الإنتاج يمنع الحصول على أي محوّل —");
check("مرجع Supabase الإنتاج", rejects({ ...STAGING, VITE_SUPABASE_PROJECT_ID: "bpdqgiytpmiagbzplrhz" }));
check("رابط Supabase الإنتاج", rejects({ ...STAGING, VITE_SUPABASE_URL: "https://bpdqgiytpmiagbzplrhz.supabase.co" }));
check("نطاق الإنتاج في متغير", rejects({ ...STAGING, VITE_SITE_URL: "https://byrazeen.com" }));
check("التقديم من مضيف الإنتاج", rejects(STAGING, "byrazeen.com"));
check("وضع دفع حقيقي", rejects({ ...STAGING, VITE_PAYMENT_MODE: "live" }));
check("وضع واتساب حقيقي", rejects({ ...STAGING, VITE_MESSAGING_MODE: "live" }));
check("وضع شحن حقيقي", rejects({ ...STAGING, VITE_SHIPPING_MODE: "live" }));
check("وضع تتبّع حقيقي", rejects({ ...STAGING, VITE_ANALYTICS_MODE: "live" }));
check("VITE_APP_ENV = production", rejects({ ...STAGING, VITE_APP_ENV: "production" }));

console.log(failures === 0 ? "\n✅ الحقن مرفوض في مسار التطبيق نفسه" : `\n❌ ${failures} مخالفة`);
process.exit(failures === 0 ? 0 : 1);
