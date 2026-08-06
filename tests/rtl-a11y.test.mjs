/**
 * حواجز RTL وإتاحة — تُثبِّت ما قِيس في المتصفح كي لا يعود.
 *
 * كل بند هنا كان عيباً مقيساً: رقم إماراتي يُعرض مقلوباً، رسائل تحقّق مرئية
 * وغير مربوطة بحقولها، اختيار باللون وحده، صفحات بلا عنوان واحد، بريد يُقرأ
 * بالعكس، حالات إنجليزية داخل جملة عربية، وحدّ عناصر تحت 3:1.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
let failed = 0;
const check = (name, ok) => { console.log(`  ${ok ? "✅" : "❌"} ${name}`); if (!ok) failed++; };

const lum = (hex) => {
  const c = hex.replace("#", "").match(/../g).map((x) => parseInt(x, 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

console.log("\n— اتجاه النصّ —");
const checkout = read("src/pages/Checkout.tsx");
check('حقل الجوال يحمل dir="ltr"', /id="phone"[\s\S]{0,240}dir="ltr"/.test(checkout));
check("ومحاذاته تبقى start", /id="phone"[\s\S]{0,300}textAlign: "start"/.test(checkout));
const outbox = read("src/pages/Outbox.tsx");
check("صندوق الصادر يعزل المستقبِل والمحوّل", /<Iso[^>]*>\{e\.to/.test(outbox) && /adapter\}\.\$\{e\.method\}/.test(outbox));
check("قائمة التصنيع تعزل كل مقطع لاتيني", /<Iso[^>]*>\{l\.title\}<\/Iso>/.test(read("src/pages/ProductionQueue.tsx")));
check("رقم الطلب لا ينكسر بين سطرين", /\.num \{ white-space: nowrap; \}/.test(read("src/styles.css")));

console.log("\n— التحقّق والإتاحة —");
for (const f of ["name", "phone", "emirate", "area", "street", "building"]) {
  check(`الحقل ${f} مربوط برسالته ومُعلَّم غير صالح`,
    new RegExp(`aria-invalid=\\{errors\\.${f}`).test(checkout) &&
    new RegExp(`aria-describedby=\\{errors\\.${f} \\? errId\\("${f}"\\)`).test(checkout));
}
check("الإرسال الناقص ينقل التركيز لأول حقل", /FIELD_ORDER\.find\(\(k\) => found\[k\]\)/.test(checkout));
check("رسالة الحقل تُعرَّف بمُعرِّف إلزامي", /FieldError\(\{ id, message \}: \{ id: string/.test(read("src/components/states.tsx")));

console.log("\n— حالة الاختيار مُعلَنة لا ملوَّنة —");
check("نتيجة الدفع مجموعة اختيار", /role="radiogroup"[\s\S]{0,400}aria-checked=\{outcome === "success"\}/.test(checkout));
check("أحجام العطر مجموعة اختيار", /role="radiogroup"[\s\S]{0,400}aria-checked=\{size === s\}/.test(read("src/pages/CustomPerfume.tsx")));

console.log("\n— العناوين والإعلان —");
const states = read("src/components/states.tsx");
check("عنوان حالة الفراغ عنوانٌ حقيقي", /const H = \(headingLevel === 1 \? "h1" : "h2"\)/.test(states));
check("لا عنوان قسم باقٍ كفقرة", !/<p className="eyebrow">(?!دار عطور)/.test(
  ["Cart", "Checkout", "CustomPerfume", "AdminOrder", "Outbox", "Ready", "Search"].map((p) => read(`src/pages/${p}.tsx`)).join("\n")));
const shell = read("src/components/AppShell.tsx");
check("مُعلِن المسار موجود والتركيز ينتقل إلى main", /data-testid="route-announcer"/.test(shell) && /mainRef\.current\?\.focus\(\)/.test(shell));
check("نتائج البحث في منطقة حيّة", /role="status" aria-live="polite"/.test(read("src/pages/Search.tsx")));
check('شريط الخطوات على /custom له مقابل نصّي', /الخطوة \{step\} من 2/.test(read("src/pages/CustomPerfume.tsx")));

console.log("\n— لغة الحالات ومطابقة العدد —");
const labels = read("src/lib/statusLabels.ts");
check("خرائط الحالات الثلاث معرَّفة", /PRODUCTION_LABEL/.test(labels) && /SHIPPING_LABEL/.test(labels) && /PAYMENT_LABEL/.test(labels));
for (const page of ["Admin", "ProductionQueue", "AdminOrder", "Account"]) {
  const src = read(`src/pages/${page}.tsx`);
  check(`${page}: لا حالة إنجليزية خام في الواجهة`,
    !/\{o\.productionStatus\}|\{o\.shippingStatus\}|\{o\.paymentStatus\}|\{current\.paymentStatus\}/.test(src));
}
check("مساعد مطابقة العدد موجود ومستعمَل", /export function arabicCount/.test(read("src/lib/arabic.ts")) &&
  /arabicCount\(count, ITEM_FORMS\)/.test(shell) && /arabicCount\(/.test(read("src/pages/Cart.tsx")));
check("لا أرقام عربية-هندية في الواجهة", !/[٠-٩]/.test(read("src/pages/Discover.tsx")));

console.log("\n— تباين حدود العناصر (WCAG 1.4.11) —");
const css = read("src/styles.css");
const strong = /--line-strong:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];
check("متغيّر حدّ العناصر معرَّف", Boolean(strong));
for (const [name, bg] of [["الأبيض", "#ffffff"], ["الورق", "#f7f4ef"], ["الورق الغائر", "#efeae2"]]) {
  const r = strong ? ratio(strong, bg) : 0;
  check(`حدّ العناصر على ${name} = ${r.toFixed(2)}:1 ≥ 3`, r >= 3);
}
for (const sel of [".card {", ".panel {", ".field {", ".btn.ghost {", ".chip {"]) {
  const block = css.slice(css.indexOf(sel), css.indexOf(sel) + 320);
  check(`${sel.trim()} يستعمل حدّ العناصر`, /var\(--line-strong\)/.test(block));
}
const stepOn = /\.step\.on \{ background: var\((--gold-lo|--gold)\); \}/.exec(css)?.[1];
const gold = /--gold-lo:\s*(#[0-9a-f]{6})/i.exec(css)[1];
const line = /--line:\s*(#[0-9a-f]{6})/i.exec(css)[1];
const stepRatio = stepOn === "--gold-lo" ? ratio(gold, line) : 0;
check(`الخطوة المُنجَزة مقابل المسار = ${stepRatio.toFixed(2)}:1 ≥ 3`, stepRatio >= 3);

console.log(failed === 0 ? "\n✅ الفحص نجح" : `\n❌ ${failed} فحصاً فشل`);
process.exit(failed === 0 ? 0 : 1);
