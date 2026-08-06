/**
 * حواجز تجربة الاستعمال والأداء — تُثبِّت ما قِيس في المتصفح كي لا يعود.
 *
 * كل بند هنا كان عيباً مقيساً في الواجهة التجريبية: فشل دفع بلا طريق عودة،
 * نصّ استثناء إنجليزي في وجه عميل عربي، شبكة معلّقة بلا مهلة، مظلّة Supabase
 * تُجرّ كاملةً لأجل `.from()` وحده، طلبان متطابقان لكل زيارة رفّ، والتزامٌ
 * بالمبلغ قبل عرضه، وحقول إلزامية خلف شريط الدفع، واستبيانٌ يمسحه زرّ الرجوع.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
let failed = 0;
const check = (name, ok) => { console.log(`  ${ok ? "✅" : "❌"} ${name}`); if (!ok) failed++; };

const checkout = read("src/pages/Checkout.tsx");
const states = read("src/components/states.tsx");
const useAsync = read("src/lib/useAsync.ts");
const client = read("src/lib/supabaseClient.ts");
const pkg = JSON.parse(read("package.json"));

console.log("\n— فشل الدفع ليس طريقاً مسدوداً —");
check("الإجراء الأساسي «أعد المحاولة» يعود إلى /checkout",
  /data-testid="retry-payment"/.test(checkout) && /navigate\("\/checkout"\)/.test(checkout));
check("طمأنة أن السلة محفوظة معروضة", /سلتك محفوظة/.test(checkout));
check("السلة لا تُفرَّغ إلا عند الدفع", /if \(res\.paid\) cart\.clear\(\)/.test(checkout));
// فرع الفشل لا يحمل أدوات تشغيل: الرابطان في فرع النجاح وحده.
const failureBranch = checkout.slice(checkout.indexOf(") : ("), checkout.indexOf("</>\n        )}"));
check("لا رابط صندوق الصادر في فرع الفشل", !/\/outbox/.test(failureBranch));
check("ولا رابط لوحة الإدارة", !/to="\/admin"/.test(failureBranch));

console.log("\n— لا نصّ استثناء في وجه العميل —");
check("useAsync يسجّل التفصيل التقني في الطرفية", /console\.error\("useAsync read failed"/.test(useAsync));
check("ولا يمرّر رسالة الاستثناء إلى الحالة", !/e instanceof Error \? e\.message/.test(useAsync));
check("رسالة العميل عربية ومكتوبة مرة واحدة", /تعذّر تحميل العطور\. تأكد من اتصالك وحاول مرة ثانية\./.test(useAsync));
check("ErrorState له نصّ عميل افتراضي", /hint = READ_ERROR_MESSAGE/.test(states));
for (const page of ["Admin", "Account", "ProductionQueue", "AdminOrder"]) {
  check(`${page}: رسالة فشل خاصة بالطلبات`, /errorMessage: ORDERS_ERROR/.test(read(`src/pages/${page}.tsx`)));
}

console.log("\n— الشبكة المعلّقة تنتهي إلى خطأ —");
check("مهلة القراءة معرَّفة في useAsync", /READ_TIMEOUT_MS = 10_000/.test(useAsync) && /Read timed out after/.test(useAsync));
check("والطلب نفسه يُجهَض بـAbortSignal.timeout", /AbortSignal\.timeout\(REQUEST_TIMEOUT_MS\)/.test(client));

console.log("\n— الحزمة: PostgREST وحدها. لا مظلّة، ولا مصادقة —");
//
// تغيّر بند هنا عن الجولة السابقة ويستحق أن يُقال لا أن يُمرَّر بصمت:
// `@supabase/auth-js` صارت **ممنوعة** بعد أن كانت مطلوبة. هوية المتسوّق لم
// تعد جلسة GoTrue بل رمز ضيف تُصدره `issue_guest_token` ويُرسَل وسيطاً في
// نصّ الاستدعاء. فما دخل الحزمة هو postgrest-js وحدها، و`.rpc(` مطلوب لأن
// مسار المتسوّق كله دوال.
check("لا مظلّة @supabase/supabase-js في الاعتماديات", !("@supabase/supabase-js" in (pkg.dependencies ?? {})));
check("و@supabase/postgrest-js معلَن", "@supabase/postgrest-js" in (pkg.dependencies ?? {}));
check("ولا @supabase/auth-js في الاعتماديات إطلاقاً",
  !("@supabase/auth-js" in (pkg.dependencies ?? {})) && !("@supabase/auth-js" in (pkg.devDependencies ?? {})));
// الفحص على الشيفرة لا على التعليق: الملفات تشرح ما حُذف ولماذا بالاسم.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const dataFiles = ["src/lib/supabaseClient.ts", "src/data/supabaseRepository.ts",
                   "src/data/repositorySource.ts", "src/lib/guestSession.ts"];
const srcFiles = dataFiles.map((f) => stripComments(read(f)));
check("ولا ملف يستورد المظلّة",
  srcFiles.every((f) => !/@supabase\/supabase-js/.test(f)));
check("ولا realtime ولا storage ولا functions",
  srcFiles.every((f) => !/\.channel\(|realtime|storage\.|functions\.invoke/.test(f)));
check("ولا ترويسة Authorization تُركَّب لكل طلب بعد الآن",
  !/Authorization: `Bearer \$\{token/.test(read("src/lib/supabaseClient.ts")));

console.log("\n— طلب واحد لكل قراءة فهرس، وذاكرة للرجوع —");
check("الذاكرة توحّد الطلبات الجارية", /const inflight = new Map/.test(useAsync) && /inflight\.has\(cacheKey\)/.test(useAsync));
check("والقيمة المحفوظة تمنع الطلب أصلاً", /if \(cacheKey !== undefined && cachedValues\.has\(cacheKey\)\)/.test(useAsync));
check("وإعادة المحاولة تُسقط المحفوظ", /invalidateAsyncCache\(cacheKey\)/.test(useAsync));
for (const [page, key] of [["Ready", '"products"'], ["Search", '"products"'], ["Discover", '"products"'], ["CustomPerfume", '"oils"']]) {
  check(`${page}: يقرأ بمفتاح ${key}`, new RegExp(`cacheKey: ${key}`).test(read(`src/pages/${page}.tsx`)));
}
check("Product: مفتاح لكل عطر", /cacheKey: `product:\$\{handle \?\? ""\}`/.test(read("src/pages/Product.tsx")));

console.log("\n— الملخّص قبل الالتزام، ولا حقل خلف الشريط —");
check("الإجمالي يسبق شريط الإجراء في المصدر",
  checkout.indexOf('data-testid="checkout-total"') < checkout.indexOf('<div className="actionbar">\n          <button className="btn" type="submit"'));
check("ولا شيء بينهما غير إغلاق الملخّص",
  /data-testid="checkout-total"[\s\S]{0,160}<\/div>\s*<\/div>\s*<\/div>\s*<div className="actionbar">/.test(checkout));
check("جسم النموذج معزول عن الشريط", /<div className="form-body">/.test(checkout));
const css = read("src/styles.css");
check("وحشوه بارتفاع الشريط", /\.form-body \{ padding-bottom: calc\(var\(--actionbar-h\)/.test(css));
check("وارتفاع الشريط معرَّف مرة واحدة", /--actionbar-h: calc\(var\(--tap\) \+ 26px\)/.test(css));
check("والحقل يقف فوق الشريط عند التمرير إليه", /\.form-body \.field \{ scroll-margin-bottom/.test(css));

console.log("\n— الاستبيان يعيش في الرابط —");
const discover = read("src/pages/Discover.tsx");
check("الإجابات تُقرأ من معاملات الرابط", /useSearchParams\(\)/.test(discover) && /params\.get\(q\.key\)/.test(discover));
check("والخطوة كذلك", /function readStep\(params: URLSearchParams\)/.test(discover));
check("ولا حالة محلية للإجابات", !/useState<Record<string, string>>/.test(discover));
check("وفيه «السؤال السابق»", /السؤال السابق/.test(discover));

console.log(failed === 0 ? "\n✅ حواجز التجربة والأداء نجحت" : `\n❌ ${failed} فشل`);
process.exit(failed === 0 ? 0 : 1);
