/**
 * Negative tests for the staging environment guard.
 *
 * A guard is only worth what its test can catch, so this file ends by
 * neutering the guard and asserting the suite goes red. If the mutation run
 * still passes, the suite proves nothing and this script exits non-zero.
 */
import { findViolations } from "../.build/envGuard.mjs";

let failures = 0;
const check = (name, cond) => {
  console.log((cond ? "  ✅ " : "  ❌ ") + name);
  if (!cond) failures++;
};

/** A configuration that should be accepted. */
const GOOD = {
  VITE_APP_ENV: "staging",
  VITE_SUPABASE_URL: "https://stgrazeenv2abcdefgh.supabase.co",
  VITE_SUPABASE_PROJECT_ID: "stgrazeenv2abcdefgh",
  VITE_PAYMENT_MODE: "mock",
  VITE_MESSAGING_MODE: "mock",
  VITE_EMAIL_MODE: "disabled",
  VITE_SHIPPING_MODE: "mock",
  VITE_ANALYTICS_MODE: "disabled",
};
const withEnv = (patch) => ({ ...GOOD, ...patch });

console.log("\n— الحالة السليمة —");
check("تكوين staging صحيح يمر بلا مخالفات", findViolations({ env: GOOD, host: "razeen-v2-staging.lovable.app" }).length === 0);

console.log("\n— حقن موارد الإنتاج (يجب أن يفشل التطبيق) —");
check("مرجع Supabase الإنتاج في PROJECT_ID",
  findViolations({ env: withEnv({ VITE_SUPABASE_PROJECT_ID: "bpdqgiytpmiagbzplrhz" }) }).length > 0);
check("رابط Supabase الإنتاج في URL",
  findViolations({ env: withEnv({ VITE_SUPABASE_URL: "https://bpdqgiytpmiagbzplrhz.supabase.co" }) }).length > 0);
check("نطاق byrazeen.com في أي متغير",
  findViolations({ env: withEnv({ VITE_SITE_URL: "https://byrazeen.com" }) }).length > 0);
check("التطبيق يُقدَّم من byrazeen.com نفسه",
  findViolations({ env: GOOD, host: "byrazeen.com" }).length > 0);
check("التطبيق يُقدَّم من نطاق فرعي للإنتاج",
  findViolations({ env: GOOD, host: "www.byrazeen.com" }).length > 0);
check("Meta Pixel الإنتاج",
  findViolations({ env: withEnv({ VITE_META_PIXEL_ID: "778889951551824" }) }).length > 0);
check("GA4 الإنتاج",
  findViolations({ env: withEnv({ VITE_GA4_ID: "G-RCB5KWLLFN" }) }).length > 0);
check("TikTok Pixel الإنتاج",
  findViolations({ env: withEnv({ VITE_TIKTOK_ID: "D9D4SHJC77UBUU504H9G" }) }).length > 0);
check("مضيف بوابة الدفع الحقيقية (Ziina)",
  findViolations({ env: withEnv({ VITE_PAYMENT_BASE: "https://api-v2.ziina.com" }) }).length > 0);
check("مضيف Tabby الحقيقي",
  findViolations({ env: withEnv({ VITE_TABBY_BASE: "https://api.tabby.ai" }) }).length > 0);
check("مضيف WhatsApp الحقيقي (WaSender)",
  findViolations({ env: withEnv({ VITE_WA_BASE: "https://api.wasenderapi.com" }) }).length > 0);

console.log("\n— تكوين staging ناقص أو خاطئ —");
check("VITE_APP_ENV غائب", findViolations({ env: withEnv({ VITE_APP_ENV: undefined }) }).length > 0);
check("VITE_APP_ENV = production", findViolations({ env: withEnv({ VITE_APP_ENV: "production" }) }).length > 0);
check("VITE_SUPABASE_URL غائب", findViolations({ env: withEnv({ VITE_SUPABASE_URL: undefined }) }).length > 0);
check("VITE_SUPABASE_PROJECT_ID غائب", findViolations({ env: withEnv({ VITE_SUPABASE_PROJECT_ID: undefined }) }).length > 0);

console.log("\n— الخدمات الخارجية يجب أن تكون معطّلة —");
check("الدفع الحقيقي (live) مرفوض", findViolations({ env: withEnv({ VITE_PAYMENT_MODE: "live" }) }).length > 0);
check("WhatsApp الحقيقي مرفوض", findViolations({ env: withEnv({ VITE_MESSAGING_MODE: "live" }) }).length > 0);
check("البريد الحقيقي مرفوض", findViolations({ env: withEnv({ VITE_EMAIL_MODE: "live" }) }).length > 0);
check("الشحن الحقيقي مرفوض", findViolations({ env: withEnv({ VITE_SHIPPING_MODE: "live" }) }).length > 0);
check("التتبع الحقيقي مرفوض", findViolations({ env: withEnv({ VITE_ANALYTICS_MODE: "live" }) }).length > 0);
check("وضع محوّل غائب مرفوض", findViolations({ env: withEnv({ VITE_PAYMENT_MODE: undefined }) }).length > 0);
check("sandbox مسموح", findViolations({ env: withEnv({ VITE_PAYMENT_MODE: "sandbox" }) }).length === 0);

console.log(`\n${failures === 0 ? "✅ كل الاختبارات نجحت" : `❌ فشل ${failures}`}`);
process.exit(failures === 0 ? 0 : 1);
