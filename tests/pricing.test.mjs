/**
 * اختبارات سياسة التسعير المعتمدة.
 *
 * التدقيق السابق وجد الواجهة والخادم يختلفان على السعر. لذلك لا يكفي هنا أن
 * تُختبر الأرقام: يجب أن يُثبَت أن الرقم المعروض هو **نفسه** الرقم المحفوظ في
 * الطلب، حرفياً. آخر قسم في هذا الملف يفشل إن أعادت أي صفحة حساب سعر بنفسها.
 *
 * node عادي، بلا إطار اختبار — كما في tests/guard.negative.mjs.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const outdir = root + ".build/pricing";
mkdirSync(outdir, { recursive: true });

// نبني نفس شيفرة التطبيق (لا نسخة موازية) كي يكون المُختبَر هو المُشحَن.
execFileSync(root + "node_modules/.bin/esbuild", [
  root + "src/lib/pricing.ts",
  root + "src/lib/orderDraft.ts",
  root + "src/data/memoryRepository.ts",
  "--bundle", "--splitting", "--format=esm", "--platform=node",
  "--log-level=error", "--loader:.json=json", "--alias:@=" + root + "src",
  "--outdir=" + outdir,
], { stdio: "inherit" });

const pricing = await import(outdir + "/lib/pricing.js");
const { buildOrderDraft } = await import(outdir + "/lib/orderDraft.js");
const { mockRepository } = await import(outdir + "/data/memoryRepository.js");

const {
  totals, lineTotalFils, customPriceFils, readyMadePriceFils, isPurchasable,
  percentOfFils, roundHalfUpFils, formatFils,
  SHIPPING_FLAT_FILS, BULK_THRESHOLD_ITEMS, BULK_DISCOUNT_PERCENT, FILS_PER_AED,
} = pricing;

let failures = 0;
const check = (name, cond) => {
  console.log((cond ? "  ✅ " : "  ❌ ") + name);
  if (!cond) failures++;
};
const eq = (name, actual, expected) =>
  check(`${name} (المتوقع ${expected}، والفعلي ${actual})`, Object.is(actual, expected));

const ready = (fils, quantity = 1) => ({ kind: "ready", unitPriceFils: fils, quantity });
const custom = (size, quantity = 1) => ({ kind: "custom", size, unitPriceFils: customPriceFils(size), quantity });

// ---------------------------------------------------------------------------
console.log("\n— الشحن الثابت وحد الكمية —");
// ---------------------------------------------------------------------------
eq("الشحن الثابت = 25 درهماً", SHIPPING_FLAT_FILS, 2500);
eq("حد الكمية = 3", BULK_THRESHOLD_ITEMS, 3);
eq("نسبة الخصم = 5%", BULK_DISCOUNT_PERCENT, 5);

const one = totals([ready(28900)]);
eq("عطر واحد: الشحن 25 درهماً", one.shippingFils, 2500);
eq("عطر واحد: بلا خصم", one.discountFils, 0);
eq("عطر واحد: الإجمالي = المجموع + الشحن", one.totalFils, 28900 + 2500);

const two = totals([ready(28900), ready(24500)]);
eq("عطران: عدد الأصناف 2", two.itemCount, 2);
eq("عطران: الشحن 25 درهماً", two.shippingFils, 2500);
eq("عطران: لا خصم", two.discountFils, 0);
eq("عطران: الإجمالي = 559 درهماً", two.totalFils, 28900 + 24500 + 2500);

const twoOneLine = totals([ready(28900, 2)]);
eq("سطر واحد بكمية 2: نفس نتيجة سطرين", twoOneLine.shippingFils, 2500);
eq("سطر واحد بكمية 2: لا خصم", twoOneLine.discountFils, 0);

const three = totals([ready(28900), ready(24500), ready(35500)]);
const threeSub = 28900 + 24500 + 35500;
eq("ثلاثة عطور: عدد الأصناف 3", three.itemCount, 3);
eq("ثلاثة عطور: الشحن مجاني", three.shippingFils, 0);
eq("ثلاثة عطور: خصم 5%", three.discountFils, percentOfFils(threeSub, 5));
eq("ثلاثة عطور: الإجمالي = المجموع − الخصم", three.totalFils, threeSub - three.discountFils);
check("ثلاثة عطور: قاعدة الكمية مُطبَّقة", three.bulkApplied === true);

const threeOneLine = totals([ready(28900, 3)]);
eq("ثلاث قطع من سطر واحد: شحن مجاني", threeOneLine.shippingFils, 0);
eq("ثلاث قطع من سطر واحد: خصم 5%", threeOneLine.discountFils, percentOfFils(28900 * 3, 5));

const four = totals([ready(28900, 4)]);
eq("أربعة عطور: الشحن مجاني", four.shippingFils, 0);
eq("أربعة عطور: خصم 5%", four.discountFils, percentOfFils(28900 * 4, 5));
const seven = totals([ready(28900, 5), custom("100ml", 2)]);
eq("سبعة عطور: الشحن مجاني", seven.shippingFils, 0);
check("سبعة عطور: خصم موجود", seven.discountFils > 0);

// ---------------------------------------------------------------------------
console.log("\n— سلة مختلطة (جاهز + مخصص) تعبر حد الثلاثة —");
// ---------------------------------------------------------------------------
const mixedTwo = totals([ready(28900), custom("50ml")]);
eq("جاهز + مخصص (2): الشحن 25 درهماً", mixedTwo.shippingFils, 2500);
eq("جاهز + مخصص (2): لا خصم", mixedTwo.discountFils, 0);

const mixedThree = totals([ready(28900), custom("50ml"), custom("100ml")]);
const mixedSub = 28900 + 28000 + 32000;
eq("جاهز + مخصصان (3): عدد الأصناف 3", mixedThree.itemCount, 3);
eq("جاهز + مخصصان (3): الشحن مجاني", mixedThree.shippingFils, 0);
eq("جاهز + مخصصان (3): المجموع", mixedThree.subtotalFils, mixedSub);
eq("جاهز + مخصصان (3): خصم 5%", mixedThree.discountFils, percentOfFils(mixedSub, 5));
eq("جاهز + مخصصان (3): الإجمالي", mixedThree.totalFils, mixedSub - percentOfFils(mixedSub, 5));

// ---------------------------------------------------------------------------
console.log("\n— العطر المخصص: مقاسان فقط —");
// ---------------------------------------------------------------------------
eq("50ml = 280 درهماً", customPriceFils("50ml"), 28000);
eq("100ml = 320 درهماً", customPriceFils("100ml"), 32000);
eq("200ml غير مسعَّر", customPriceFils("200ml"), null);
eq("مقاس مجهول غير مسعَّر", customPriceFils("75ml"), null);
eq("بلا مقاس: غير مسعَّر", customPriceFils(undefined), null);
check("200ml غير قابل للشراء", isPurchasable(customPriceFils("200ml")) === false);
check("لا معادلة ولا مضاعِف مقاس: 100ml ليس ضعف 50ml", customPriceFils("100ml") !== customPriceFils("50ml") * 2);

// ---------------------------------------------------------------------------
console.log("\n— العطر الجاهز: السعر المخزَّن كما هو، وإلا فلا شراء —");
// ---------------------------------------------------------------------------
eq("السعر المخزَّن يُعاد حرفياً", readyMadePriceFils(31337), 31337);
eq("price_fils = 0 ⇒ لا سعر", readyMadePriceFils(0), null);
eq("price_fils سالب ⇒ لا سعر", readyMadePriceFils(-100), null);
eq("price_fils = null ⇒ لا سعر", readyMadePriceFils(null), null);
eq("price_fils غائب ⇒ لا سعر", readyMadePriceFils(undefined), null);
eq("price_fils عشري ⇒ لا سعر (الفلس عدد صحيح)", readyMadePriceFils(28.9), null);
check("price_fils = 0 غير قابل للشراء", isPurchasable(readyMadePriceFils(0)) === false);
eq("سطر بسعر 0 لا يُسعَّر", lineTotalFils({ unitPriceFils: 0, quantity: 3 }), 0);
const withZero = totals([ready(0, 3), ready(28900)]);
eq("سطر بسعر 0 لا يدخل المجموع", withZero.subtotalFils, 28900);
eq("سطر بسعر 0 لا يُحتسب في عدد الأصناف", withZero.itemCount, 1);
eq("سطر بسعر 0 لا يمنح شحناً مجانياً", withZero.shippingFils, 2500);

// السلة نفسها ترفض السطر غير القابل للشراء (نفس شرط القبول في `cart.add`).
check("شرط دخول السلة يرفض سعر 0", isPurchasable(0) === false);
check("شرط دخول السلة يقبل سعراً صالحاً", isPurchasable(28900) === true);

// ---------------------------------------------------------------------------
console.log("\n— دقة الفلس الصحيح: لا انزلاق عشري —");
// ---------------------------------------------------------------------------
eq("تقريب النصف لأعلى: 5% من 10 فلوس = 1 (0.5 ⇒ لأعلى)", percentOfFils(10, 5), 1);
eq("تقريب النصف لأعلى: 5% من 9 فلوس = 0 (0.45 ⇒ لأسفل)", percentOfFils(9, 5), 0);
eq("تقريب النصف لأعلى: 10 ÷ 4 = 3", roundHalfUpFils(10, 4), 3);
eq("تقريب النصف لأعلى: 6 ÷ 4 = 2 (النصف لأعلى)", roundHalfUpFils(6, 4), 2);
eq("5% من 28901 فلساً = 1445 (1445.05 ⇒ لأسفل)", percentOfFils(28901, 5), 1445);
eq("5% من 28910 فلساً = 1446 (1445.5 ⇒ لأعلى)", percentOfFils(28910, 5), 1446);
eq("5% من 8330 فلساً = 417 (416.5 ⇒ لأعلى)", percentOfFils(8330, 5), 417);
eq("5% من 8310 فلساً = 416 (415.5 ⇒ لأعلى)", percentOfFils(8310, 5), 416);

// نفس المجموع الفردي يعطي نفس الفلس في كل مرة، وكل النتائج أعداد صحيحة.
const odd = 28901 * 3;
const firstOdd = percentOfFils(odd, 5);
let stable = true;
for (let i = 0; i < 1000; i++) if (percentOfFils(odd, 5) !== firstOdd) stable = false;
check(`خصم مجموع فردي ثابت في ألف تكرار (${firstOdd} فلساً)`, stable);
check("الخصم عدد صحيح لا عشري", Number.isInteger(firstOdd));

let allInteger = true;
for (let unit = 1; unit <= 2000; unit++) {
  const t = totals([{ unitPriceFils: unit * 7 + 1, quantity: 3 }]);
  if (![t.subtotalFils, t.discountFils, t.shippingFils, t.totalFils].every(Number.isInteger)) allInteger = false;
  if (t.totalFils !== t.subtotalFils - t.discountFils + t.shippingFils) allInteger = false;
}
check("كل المجاميع أعداد فلس صحيحة على 2000 حالة", allInteger);
// الطريق العشري الخاطئ (0.05 على العدد العشري) يعطي رقماً مغايراً — نثبت أننا لا نسلكه.
check("لا يُستعمل حساب عشري (0.05 × الدرهم)",
  percentOfFils(8330, 5) !== Math.round((8330 / 100) * 0.05) * 100);
eq("الصياغة من الفلس مباشرة", formatFils(2500), "25 د.إ");
eq("الصياغة تُظهر الفلس عند وجوده", formatFils(1445), "14.45 د.إ");
eq("1 درهم = 100 فلس", FILS_PER_AED, 100);

// ---------------------------------------------------------------------------
console.log("\n— ضمان عدم الانزلاق: المعروض = المحفوظ —");
// ---------------------------------------------------------------------------
const cartLines = [
  { id: "ready:stg-amber-oud", kind: "ready", title: "[STG] عنبر وعود", unitPriceFils: 28900, quantity: 2 },
  { id: "custom:STG-001:50ml", kind: "custom", title: "[STG] BRAND ALPHA — MIDNIGHT FIG", unitPriceFils: customPriceFils("50ml"), quantity: 1, size: "50ml", perfumeCode: "STG-001" },
];
// ما تعرضه الواجهة (السلة وإتمام الطلب يستدعيان `totals` نفسها).
const shown = totals(cartLines);
eq("السلة المختبَرة: 3 عطور", shown.itemCount, 3);
eq("السلة المختبَرة: شحن مجاني", shown.shippingFils, 0);

const customer = {
  name: "عميل تجريبي أول", phone: "971500000001",
  address: { emirate: "دبي", area: "منطقة تجريبية", street: "شارع الاختبار", building: "مبنى ١" },
};
const draft = buildOrderDraft(cartLines, customer);
const persisted = await mockRepository.createOrder(draft);

eq("المحفوظ: المجموع مطابق للمعروض", persisted.subtotalFils, shown.subtotalFils);
eq("المحفوظ: الخصم مطابق للمعروض", persisted.discountFils, shown.discountFils);
eq("المحفوظ: الشحن مطابق للمعروض", persisted.shippingFils, shown.shippingFils);
eq("المحفوظ: الإجمالي مطابق للمعروض", persisted.totalFils, shown.totalFils);
check("المحفوظ: عدد السطور مطابق", persisted.lines.length === cartLines.length);
let linesMatch = true;
persisted.lines.forEach((line, i) => {
  if (line.unitPriceFils !== cartLines[i].unitPriceFils) linesMatch = false;
  if (lineTotalFils(line) !== lineTotalFils(cartLines[i])) linesMatch = false;
});
check("المحفوظ: سعر الوحدة ومجموع السطر مطابقان حرفياً", linesMatch);
eq("المحفوظ: الإجمالي = المجموع − الخصم + الشحن",
  persisted.totalFils, persisted.subtotalFils - persisted.discountFils + persisted.shippingFils);
// المبلغ المُمرَّر لبوابة الدفع هو نفسه، بالفلس، بلا تحويل.
eq("مبلغ الدفع = إجمالي الطلب بالفلس", persisted.totalFils, shown.totalFils);

const reread = await mockRepository.getOrder(persisted.orderNumber);
eq("إعادة القراءة: الإجمالي لم يتغيّر", reread.totalFils, shown.totalFils);
eq("إعادة القراءة: الخصم لم يتغيّر", reread.discountFils, shown.discountFils);

// ---------------------------------------------------------------------------
console.log("\n— لا صفحة تحسب سعراً بنفسها —");
// ---------------------------------------------------------------------------
// هذا الفحص هو ما يفشل إن أعاد أحدهم حساب سعر داخل صفحة لاحقاً.
const sourceFiles = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(p)) sourceFiles.push(p);
  }
};
walk(join(root, "src/pages"));
walk(join(root, "src/components"));

const PRICING_MODULE = join(root, "src/lib/pricing.ts");
/** حساب على مبلغ: أي عملية حسابية يشارك فيها معرّف يحمل Fils/price. */
const MONEY_ARITHMETIC = [
  /[A-Za-z_$][\w$.]*(?:Fils|Price|price)\b\s*[-+*/%]\s*[^=>]/,
  /[-+*/%]\s*[A-Za-z_$][\w$.]*(?:Fils|Price|price)\b/,
  /\b(?:0\.05|0\.95|\/\s*100|\*\s*100)\b/,
];
const offenders = [];
for (const file of sourceFiles) {
  const source = readFileSync(file, "utf8");
  source.split("\n").forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "");
    if (/^\s*\*/.test(code)) return;
    if (MONEY_ARITHMETIC.some((re) => re.test(code))) offenders.push(`${file.slice(root.length)}:${i + 1}: ${line.trim()}`);
  });
}
if (offenders.length > 0) offenders.forEach((o) => console.log("     ↳ " + o));
check("لا صفحة ولا مكوّن يجري حساباً على مبلغ", offenders.length === 0);

// الصفحات لا تعرّف أرقام السياسة عندها؛ الأرقام كلها من وحدة التسعير.
const policyLiterals = [/\b2500\b/, /\b28000\b/, /\b32000\b/, /BULK_THRESHOLD_ITEMS\s*=/, /SHIPPING_FLAT_FILS\s*=/];
const literalOffenders = sourceFiles.filter((f) => {
  const source = readFileSync(f, "utf8");
  return policyLiterals.some((re) => re.test(source));
});
check("لا رقم من أرقام السياسة مكتوب داخل صفحة", literalOffenders.length === 0);

// وحدة التسعير موجودة وحيدة: لا بقايا للمُسعِّر التجريبي القديم في المستودع.
const leftovers = [];
const scanRoots = ["src", "tests", "docs"].map((d) => join(root, d));
const walkAll = (dir, acc) => {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walkAll(p, acc);
    else if (/\.(tsx?|mjs|md|css)$/.test(p)) acc.push(p);
  }
};
const allFiles = [];
for (const dir of scanRoots) { try { walkAll(dir, allFiles); } catch { /* المجلد غير موجود */ } }
for (const file of [...allFiles, join(root, "README.md")]) {
  if (file === new URL(import.meta.url).pathname) continue;
  const source = readFileSync(file, "utf8");
  if (/STAGING_PRICING_PLACEHOLDER|PLACEHOLDER_PRICE_NOTE|isPlaceholder/.test(source)) leftovers.push(file.slice(root.length));
}
if (leftovers.length > 0) leftovers.forEach((f) => console.log("     ↳ " + f));
check("لا أثر للمُسعِّر التجريبي القديم", leftovers.length === 0);
check("وحدة التسعير المعتمدة موجودة", readFileSync(PRICING_MODULE, "utf8").includes("roundHalfUpFils"));

console.log(`\n${failures === 0 ? "✅ كل اختبارات التسعير نجحت" : `❌ فشل ${failures}`}`);
process.exit(failures === 0 ? 0 : 1);
