/**
 * إثبات المتسوّق المجهول — anonymous session proof.
 *
 * الجولة السابقة كتبت السياسات والدالة الذرّية؛ هذه الجولة نقلت الواجهة
 * إليهما. والسؤال الذي يجيب عنه هذا الملف واحد: **هل صار المتصفّح فعلاً غير
 * قادر على ما كان يقدر عليه؟** لا «هل كُتب الحارس»، بل «هل يمنع».
 *
 * لذلك كل حالة هنا استعلامٌ حقيقي بدور حقيقي، وكل ادّعاء منع يُتبَع بقراءة
 * القيمة المخزَّنة من جديد. الفرق جوهري: جملةٌ تفشل قد تفشل لسبب آخر تماماً،
 * وقد تنجح جزئياً. القيمة التي لم تتغيّر هي الدليل الوحيد الذي لا يُلتَفّ عليه.
 *
 * جلستان مجهولتان متمايزتان (`sub` مختلف، و`is_anonymous: true` في الادّعاءات
 * كما يفعل Supabase حرفياً) تلعبان دور متصفّحين. و«إعادة التحميل» تُحاكى بما
 * هي عليه فعلاً: معاملة جديدة بالادّعاءات نفسها، بعد أن يكون ما قبلها قد
 * التزم — لا بجملة أخرى داخل المعاملة نفسها.
 *
 * يحتاج قاعدة PostgreSQL حقيقية:
 *   DATABASE_URL=postgres://... node tests/anon-session.test.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql = (p) => readFileSync(join(ROOT, p), "utf8");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

let failures = 0;
const check = (name, cond) => {
  console.log((cond ? "  ✅ " : "  ❌ ") + name);
  if (!cond) failures++;
};
const eq = (name, actual, expected) =>
  check(`${name} (المتوقع ${expected}، والفعلي ${actual})`, Object.is(actual, expected));

// ---------------------------------------------------------------------------
// القسم الأول: المصدر — الطلب والسلة لم يعودا يسكنان التخزين المحلي
//
// يعمل بلا قاعدة بيانات عمداً. سؤاله ليس «هل السياسة صحيحة» بل «هل الواجهة
// تسأل القاعدة أصلاً»: مسارٌ يقرأ حالته من `localStorage` لا تحرسه أي سياسة
// مهما كانت محكمة، لأنه لا يمرّ بها.
// ---------------------------------------------------------------------------
console.log("\n— المصدر: لا حالة طلب في التخزين المحلي —");

/**
 * الفحص على الشيفرة لا على النثر. الملفات تشرح ما نُقل ولماذا — وذكر
 * `localStorage` في تعليق يقول «لا نستعمله» يجب ألّا يُحسب استعمالاً.
 */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const supabaseRepo = code(read("src/data/supabaseRepository.ts"));
const orderFlow = code(read("src/lib/orderFlow.ts"));
const checkout = code(read("src/pages/Checkout.tsx"));
const cart = code(read("src/lib/cart.tsx"));
const contract = code(read("src/data/repositoryContract.ts"));
const anonSessionSrc = read("src/lib/anonSession.ts");
const clientSrc = read("src/lib/supabaseClient.ts");

check("تنفيذ Supabase لا يلمس localStorage إطلاقاً", !/localStorage/.test(supabaseRepo));
check("ومسار الطلب كذلك", !/localStorage/.test(orderFlow));
check("وشاشة إتمام الطلب كذلك", !/localStorage/.test(checkout));
check("والعقد لا يعرف تخزيناً محلياً", !/localStorage/.test(contract));

// السلة: التخزين المحلي باقٍ، لكن بصفة ذاكرة عابرة معلنة — لا مصدر.
check("السلة تقرأ من القاعدة", /repository\.loadCart\(\)/.test(cart));
check("وتكتب إليها عند كل تغيير", /repository\.saveCart\(/.test(cart));
check("والقادم من الخادم يستبدل النسخة المحلية",
  /setLines\(\(cached\)/.test(cart) && /\.\.\.serverLines/.test(cart));
check("ولا تُكتب سلة إلى الخادم قبل وصول قراءته",
  /if \(!hydrated\.current\) return;/.test(cart));
check("ومفتاح التخزين يسمّي نفسه ذاكرةً لا مصدراً",
  /razeen_v2_staging_cart_cache/.test(cart) && /CACHE_KEY/.test(cart));
check("ولا مفتاح طلبات محلي خارج تنفيذ الذاكرة الاحتياطي",
  !/razeen_v2_staging_orders/.test(supabaseRepo + orderFlow + checkout + cart));

console.log("\n— المصدر: المتصفّح لا يرسل سعراً —");
const itemsFn = orderFlow.slice(orderFlow.indexOf("export function itemsFromLines"),
                                orderFlow.indexOf("export async function placeOrder"));
check("بناء البنود لا يمرّر أي مبلغ", !/Fils/.test(itemsFn));
check("والبند في العقد بلا حقل سعر",
  !/unitPriceFils/.test(contract.slice(contract.indexOf("interface PlaceOrderItem"),
                                       contract.indexOf("interface PlaceOrderRequest"))));
check("والإنشاء يمرّ بـ place_order وحدها",
  /\.rpc\("place_order"/.test(supabaseRepo) && !/from\("orders"\)\s*\.insert/.test(supabaseRepo));
check("وحالات الطلب تُكتب عبر الباب الإداري لا بـ UPDATE",
  /\.rpc\("admin_set_order_status"/.test(supabaseRepo)
  && !/from\("orders"\)[\s\S]{0,40}\.update\(/.test(supabaseRepo));

console.log("\n— المصدر: جلسة واحدة، تُقرأ قبل أن تُنشأ —");
check("الموجود يُقرأ أولاً", anonSessionSrc.indexOf("getSession()") < anonSessionSrc.indexOf("signInAnonymously()"));
check("ولا توقيع دخول إلا بعد أن يكون الجواب لا",
  /if \(existing\.data\.session\)[\s\S]{0,200}return existing\.data\.session;/.test(anonSessionSrc));
check("والاستدعاءات المتزامنة تشترك في وعد واحد", /if \(!bootstrap\)/.test(anonSessionSrc));
check("والجلسة تُحفظ وتُجدَّد",
  /persistSession: true/.test(anonSessionSrc) && /autoRefreshToken: true/.test(anonSessionSrc));
check("والرمز يتتبّع التجديد عبر onAuthStateChange", /onAuthStateChange\(/.test(anonSessionSrc));
check("ويُركَّب على كل طلب PostgREST", /currentAccessToken\(\)/.test(clientSrc));
check("والمفتاح يُولَّد مرة لكل محاولة ويُعاد استعماله",
  /useRef<string>\(newIdempotencyKey\(\)\)/.test(checkout) && /idempotencyKey\.current/.test(checkout));

// ---------------------------------------------------------------------------
// القسم الثاني: قرار تسجيل الدخول المجهول بلا بوّابة بشرية — موثَّق لا منسيّ
//
// هذا الفحص لا يقيس سلوكاً بل يحرس قراراً: أن يبقى مكتوباً **لماذا** لا توجد
// بوّابة، وما الذي يحدّ الضرر اليوم، وما الذي لا يحدّه، وما شرط الإطلاق.
// قرارٌ غير مكتوب يُنسى، وقرارٌ منسيّ يُعاد اتخاذه بالصدفة.
// ---------------------------------------------------------------------------
console.log("\n— قرار «بلا بوّابة بشرية» موثَّق في مكانين —");
const readme = read("README.md");
check("README فيه قسم معنون لتسجيل الدخول المجهول", /## إساءة استعمال تسجيل الدخول المجهول/.test(readme));
check("ويسمّي الخطر: إنشاء حسابات بلا حدّ", /غير محدود|بلا حدّ/.test(readme) && /auth\.users/.test(readme));
check("ويسمّي الجداول القابلة للتضخّم", /carts/.test(readme) && /cart_items/.test(readme));
check("ويسمّي ما يحدّ الضرر اليوم",
  /RESTRICTIVE/.test(readme) && /place_order/.test(readme)
  && /idempotency/i.test(readme) && /cleanup_stale_anonymous_users/.test(readme));
check("ويقول بصراحة ما الذي لا يُمنع اليوم",
  /وما لا يُمنع اليوم/.test(readme) && /لا تحديد معدّل/.test(readme));
check("ويحدّد شرط الإطلاق: Turnstile في Attack Protection + تحديد المعدّل",
  /Turnstile/.test(readme) && /Attack Protection/.test(readme) && /(rate limit|تحديد المعدّل)/i.test(readme));
check("ويبرّر القبول في staging وحدها",
  /robots\.txt/.test(readme) && /(وهمية|mock)/.test(readme));
check("وموضع الاستدعاء نفسه يحمل السبب لا إحالةً فقط",
  /Turnstile/.test(anonSessionSrc) && /captchaToken/.test(anonSessionSrc));
check("ولا سكربت طرف ثالث دخل الشيفرة لأجل ذلك",
  !/challenges\.cloudflare\.com|hcaptcha\.com|recaptcha/.test(anonSessionSrc + read("index.html")));

// ---------------------------------------------------------------------------
// القسم الثالث: القاعدة. من هنا فصاعداً لا شيء يُفحص في نصّ، وكل شيء يُقاس.
// ---------------------------------------------------------------------------
const CONNECTION = process.env.DATABASE_URL;
if (!CONNECTION) {
  console.error("❌ DATABASE_URL غير معرّف — القسم الثاني يحتاج قاعدة PostgreSQL حقيقية");
  process.exit(1);
}

const A = "11111111-aaaa-4aaa-8aaa-111111111111"; // متصفّح أ
const B = "22222222-bbbb-4bbb-8bbb-222222222222"; // متصفّح ب
const C = "33333333-cccc-4ccc-8ccc-333333333333"; // متصفّح ثالث، لم يشترِ شيئاً

const client = new pg.Client({ connectionString: CONNECTION });

/**
 * معاملة كاملة بادّعاءات جلسة مجهولة — **تلتزم** ما لم يُطلب التراجع.
 *
 * الالتزام هنا شرطٌ في التصميم لا تفصيل: «الحالة تنجو من إعادة التحميل» ادّعاء
 * عن ما يبقى بعد انتهاء الطلب. اختبارٌ يتراجع دائماً لا يستطيع أن يفحصه.
 */
async function session(sub, fn, { rollback = false } = {}) {
  await client.query("begin");
  try {
    await client.query("select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub, role: "authenticated", is_anonymous: true })]);
    await client.query("set local role authenticated");
    const out = await fn();
    await client.query(rollback ? "rollback" : "commit");
    return out;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

/** قراءة بلا سياسات — للتحقّق من القيمة المخزَّنة فعلاً بعد كل محاولة تزوير. */
async function stored(text, params = []) {
  const r = await client.query(text, params);
  return r.rows[0];
}

let probeSeq = 0;
/** محاولة يُتوقَّع رفضها. تُسوَّر بنقطة حفظ كي تنجو المعاملة وتكمل الحالات. */
async function probe(text, params = []) {
  const sp = `p_${++probeSeq}`;
  await client.query(`savepoint ${sp}`);
  try {
    const r = await client.query(text, params);
    await client.query(`release savepoint ${sp}`);
    return { threw: false, rowCount: r.rowCount };
  } catch {
    await client.query(`rollback to savepoint ${sp}`);
    await client.query(`release savepoint ${sp}`);
    return { threw: true, rowCount: 0 };
  }
}

const rows = async (text, params = []) => (await client.query(text, params)).rows;

async function main() {
  await client.connect();

  await client.query("drop schema if exists public cascade; create schema public;");
  await client.query("drop schema if exists auth cascade;");
  await client.query(sql("supabase/test/shim.sql"));
  for (const f of ["0001_baseline", "0002_rls", "0003_audit", "0004_harden_audit",
                   "0005_anon_ownership", "0006_restrictive_writes", "0007_place_order",
                   "0008_anon_cleanup"]) {
    await client.query(sql(`supabase/migrations/${f}.sql`));
  }
  await client.query(sql("supabase/seed/staging_seed.sql"));

  // ثلاثة متصفّحين = ثلاثة حسابات مجهولة، كما ينشئها signInAnonymously.
  for (const id of [A, B, C]) {
    await client.query(
      "insert into auth.users (id, is_anonymous) values ($1, true) on conflict do nothing", [id]);
  }

  const variant = (await rows(
    "select id, price_fils from public.product_variants where sku = 'stg-amber-oud-100ml'"))[0];

  // -------------------------------------------------------------------------
  console.log("\n— متصفّح أ يشتري: استدعاء واحد يكتب كل شيء —");
  // -------------------------------------------------------------------------
  const KEY_A = "key-a-first-attempt";
  const placedA = await session(A, async () => (await rows(
    `select public.place_order($1::jsonb, $2::jsonb, $3, 'success') as r`,
    [JSON.stringify([{ kind: "ready", variant_id: variant.id, quantity: 1 }]),
     JSON.stringify({ full_name: "متسوّق أ", phone: "0500000101", emirate: "دبي",
                      area: "منطقة أ", street: "شارع أ", building: "مبنى أ" }),
     KEY_A]))[0].r);

  check("الطلب أُنشئ برقم", typeof placedA.order_number === "string" && placedA.order_number.length > 0);
  eq("وحالة الدفع مدفوع", placedA.payment_status, "paid");
  eq("والمجموع = سعر المقاس المخزَّن", placedA.subtotal_fils, variant.price_fils);
  eq("والشحن ثابت لعطر واحد", placedA.shipping_fils,
    Number((await rows("select public.shipping_flat_fils() as n"))[0].n));
  eq("والإجمالي = المجموع + الشحن", placedA.total_fils, placedA.subtotal_fils + placedA.shipping_fils);

  const orderA = await stored(
    "select id, total_fils, payment_status from public.orders where order_number = $1", [placedA.order_number]);
  check("والبنود كُتبت مع الطلب", Number((await stored(
    "select count(*)::int as n from public.order_items where order_id = $1", [orderA.id])).n) === 1);
  check("ودفعة وهمية واحدة", Number((await stored(
    "select count(*)::int as n from public.payments where order_id = $1", [orderA.id])).n) === 1);

  // -------------------------------------------------------------------------
  console.log("\n— السعر يُحسب في القاعدة: ما يرسله المتصفّح من مبالغ لا أثر له —");
  // -------------------------------------------------------------------------
  const forgedPrice = await session(A, async () => (await rows(
    `select public.place_order($1::jsonb, '{}'::jsonb, $2, 'success') as r`,
    [JSON.stringify([{
      kind: "ready", variant_id: variant.id, quantity: 1,
      // كل ما يلي كذبٌ صريح. الدالة لا تقرأ منه حرفاً.
      unit_price_fils: 1, price: 1, line_total_fils: 1, total_fils: 1, subtotal_fils: 1, discount_fils: 99999,
    }]), "key-a-forged-price"]))[0].r);
  eq("المجموع تجاهل السعر المرسَل", forgedPrice.subtotal_fils, variant.price_fils);
  eq("والخصم تجاهل الخصم المرسَل", forgedPrice.discount_fils, 0);
  const forgedStored = await stored(
    "select subtotal_fils, total_fils from public.orders where order_number = $1", [forgedPrice.order_number]);
  eq("والمخزَّن فعلاً هو سعر القاعدة لا المرسَل", forgedStored.subtotal_fils, variant.price_fils);

  // -------------------------------------------------------------------------
  console.log("\n— النقرة الثانية بالمفتاح نفسه: طلب واحد لا اثنان —");
  // -------------------------------------------------------------------------
  const replay = await session(A, async () => (await rows(
    `select public.place_order($1::jsonb, $2::jsonb, $3, 'success') as r`,
    [JSON.stringify([{ kind: "ready", variant_id: variant.id, quantity: 1 }]),
     JSON.stringify({ full_name: "متسوّق أ", phone: "0500000101" }), KEY_A]))[0].r);
  eq("الردّ نفس رقم الطلب الأول", replay.order_number, placedA.order_number);
  check("ومُعلَّم بأنه إعادة لا إنشاء", replay.idempotent_replay === true);
  eq("وعدد الطلبات بهذا المفتاح واحد", Number((await stored(
    "select count(*)::int as n from public.orders where idempotency_key = $1", [KEY_A])).n), 1);

  // -------------------------------------------------------------------------
  console.log("\n— المدفوع وحده يدخل التصنيع —");
  // -------------------------------------------------------------------------
  check("الطلب المدفوع في طابور الإنتاج", Number((await stored(
    "select count(*)::int as n from public.production_queue where order_id = $1", [orderA.id])).n) === 1);

  const failedOrder = await session(A, async () => (await rows(
    `select public.place_order($1::jsonb, '{}'::jsonb, $2, 'failed') as r`,
    [JSON.stringify([{ kind: "ready", variant_id: variant.id, quantity: 1 }]), "key-a-failed"]))[0].r);
  eq("طلب الدفع الفاشل حالته failed", failedOrder.payment_status, "failed");
  const failedId = (await stored("select id from public.orders where order_number = $1",
    [failedOrder.order_number])).id;
  check("ولا يدخل طابور الإنتاج", Number((await stored(
    "select count(*)::int as n from public.production_queue where order_id = $1", [failedId])).n) === 0);

  // غير المدفوع والملغى: يُدفعان إلى الطابور مباشرةً بأعلى صلاحية ممكنة
  // (service_role يتجاوز RLS) — فالرفض الذي يقع هنا رفض القاعدة نفسها لا رفض سياسة.
  const unpaidId = (await stored(
    "select id from public.orders where payment_status <> 'paid' limit 1")).id;
  await client.query("begin");
  // ادّعاءات صريحة حتى لهذه الكتلة: triggers التدقيق تقرأ نفس الـGUC، وقيمة
  // فارغة تُسقط الجملة بخطأ تحويل — وهو فشل لا علاقة له بما نفحصه.
  await client.query("select set_config('request.jwt.claims', $1, true)",
    [JSON.stringify({ role: "service_role" })]);
  await client.query("set local role service_role");
  const pushUnpaid = await probe(
    "insert into public.production_queue (order_id, status) values ($1, 'queued')", [unpaidId]);
  await client.query("update public.orders set status = 'cancelled', payment_status = 'failed' where id = $1", [unpaidId]);
  const pushCancelled = await probe(
    "insert into public.production_queue (order_id, status) values ($1, 'queued')", [unpaidId]);
  await client.query("rollback");
  check("غير المدفوع يُرفض حتى بأعلى صلاحية", pushUnpaid.threw);
  check("والملغى كذلك", pushCancelled.threw);

  // -------------------------------------------------------------------------
  console.log("\n— متصفّح ب: طلبه وسلته وطلبه المخصص —");
  // -------------------------------------------------------------------------
  const placedB = await session(B, async () => {
    await client.query(
      "insert into public.carts (user_id, session_token, status) values ($1::uuid, $1::text, 'open')", [B]);
    return (await rows(
      `select public.place_order($1::jsonb, $2::jsonb, $3, 'success') as r`,
      [JSON.stringify([{ kind: "custom", catalog_code: "STG-001", size: "50ml", quantity: 1 }]),
       JSON.stringify({ full_name: "متسوّق ب", phone: "0500000202", emirate: "الشارقة",
                        area: "منطقة ب", street: "شارع ب", building: "مبنى ب" }),
       "key-b-first"]))[0].r;
  });
  check("طلب ب أُنشئ", typeof placedB.order_number === "string");
  eq("وسعره سعر السياسة للمقاس", placedB.subtotal_fils,
    Number((await rows("select public.custom_price_fils('50ml') as n"))[0].n));

  // سلة أ — تُنشأ وتُملأ، ثم تُقرأ في «إعادة تحميل» لاحقة.
  const cartA = await session(A, async () => {
    const id = (await rows(
      "insert into public.carts (user_id, session_token, status) values ($1::uuid, $1::text, 'open') returning id", [A]))[0].id;
    await client.query(
      `insert into public.cart_items (cart_id, variant_id, quantity, unit_price_fils)
       values ($1, $2, 2, $3)`, [id, variant.id, variant.price_fils]);
    return id;
  });

  // -------------------------------------------------------------------------
  console.log("\n— العزل في الاتجاهين: لا أحد يرى أحداً —");
  // -------------------------------------------------------------------------
  const isolation = async (me, other, label) => {
    await session(me, async () => {
      const seenOrders = await rows(
        "select order_number from public.orders where order_number = $1", [other.orderNumber]);
      check(`${label}: لا يرى طلب الآخر`, seenOrders.length === 0);
      check(`${label}: ولا بنود طلبه`, (await rows(
        "select id from public.order_items where order_id = $1", [other.orderId])).length === 0);
      check(`${label}: ولا صف عميله`, (await rows(
        "select id from public.customers where user_id = $1", [other.uid])).length === 0);
      check(`${label}: ولا سلته`, (await rows(
        "select id from public.carts where user_id = $1", [other.uid])).length === 0);
      check(`${label}: ولا بنود سلته`, (await rows(
        "select id from public.cart_items where cart_id = $1", [other.cartId])).length === 0);
      check(`${label}: ولا طلبات عطره المخصص`, (await rows(
        `select r.id from public.custom_perfume_requests r
           join public.customers c on c.id = r.customer_id where c.user_id = $1`, [other.uid])).length === 0);
    }, { rollback: true });
  };

  const orderIdB = (await stored("select id from public.orders where order_number = $1",
    [placedB.order_number])).id;
  const cartB = (await stored("select id from public.carts where user_id = $1", [B])).id;

  await isolation(A, { uid: B, orderNumber: placedB.order_number, orderId: orderIdB, cartId: cartB }, "أ عن ب");
  await isolation(B, { uid: A, orderNumber: placedA.order_number, orderId: orderA.id, cartId: cartA }, "ب عن أ");

  // كل واحد يرى ما يملكه هو — وإلا لكان العزل «صفر صفوف للجميع».
  await session(A, async () => {
    check("أ يرى طلبه هو", (await rows(
      "select id from public.orders where order_number = $1", [placedA.order_number])).length === 1);
  }, { rollback: true });
  await session(B, async () => {
    check("وب يرى طلبه هو", (await rows(
      "select id from public.orders where order_number = $1", [placedB.order_number])).length === 1);
  }, { rollback: true });

  // -------------------------------------------------------------------------
  console.log("\n— إعادة التحميل: نفس المستخدم، معاملة جديدة، الحالة باقية —");
  // -------------------------------------------------------------------------
  await session(A, async () => {
    const cartRows = await rows("select id from public.carts where status = 'open' and user_id = $1", [A]);
    eq("نفس السلة بعينها", cartRows[0]?.id, cartA);
    eq("وبنودها كما تُركت", (await rows(
      "select quantity from public.cart_items where cart_id = $1", [cartA]))[0]?.quantity, 2);
    check("ونفس الطلب ما زال مرئياً لصاحبه", (await rows(
      "select id from public.orders where order_number = $1", [placedA.order_number])).length === 1);
  }, { rollback: true });

  // -------------------------------------------------------------------------
  console.log("\n— متصفّح ثالث: لا يرث شيئاً —");
  // -------------------------------------------------------------------------
  await session(C, async () => {
    eq("لا يرى أي طلب", (await rows("select id from public.orders")).length, 0);
    eq("ولا أي سلة", (await rows("select id from public.carts")).length, 0);
    eq("ولا أي صف عميل", (await rows("select id from public.customers")).length, 0);
    eq("ولا أي بند طلب", (await rows("select id from public.order_items")).length, 0);
    check("لكنه يرى الرفّ العام", (await rows("select id from public.products")).length > 0);
  }, { rollback: true });

  // -------------------------------------------------------------------------
  console.log("\n— التزوير: المحاولة تفشل، والقيمة المخزَّنة لم تتغيّر —");
  //
  // كل حالة هنا تُقاس مرتين: مرة على المحاولة، ومرة على ما في القاعدة بعدها.
  // «الجملة أخطأت» وحدها لا تكفي — قد تخطئ لسبب آخر، وقد تكون كتبت ثم أخطأت.
  // -------------------------------------------------------------------------
  const before = await stored(
    `select total_fils, subtotal_fils, discount_fils, payment_status, status
       from public.orders where id = $1`, [orderA.id]);

  await session(A, async () => {
    const price = await probe("update public.orders set total_fils = 1 where id = $1", [orderA.id]);
    check("تعديل الإجمالي مرفوض", price.threw || price.rowCount === 0);
    const disc = await probe("update public.orders set discount_fils = 99999 where id = $1", [orderA.id]);
    check("واختراع خصم مرفوض", disc.threw || disc.rowCount === 0);
    const pay = await probe("update public.orders set payment_status = 'paid' where id = $1", [orderA.id]);
    check("وترقية حالة الدفع مرفوضة", pay.threw || pay.rowCount === 0);
    const st = await probe("update public.orders set status = 'ready' where id = $1", [orderA.id]);
    check("وترقية حالة الطلب مرفوضة", st.threw || st.rowCount === 0);
    const payRow = await probe(
      `insert into public.payments (order_id, provider, status, amount_fils)
       values ($1, 'mock', 'paid', 1)`, [orderA.id]);
    check("وكتابة دفعة مرفوضة", payRow.threw);
    const inv = await probe(
      `insert into public.inventory_movements (variant_id, delta_qty, reason)
       values ($1, 9999, 'restock')`, [variant.id]);
    check("وكتابة حركة مخزون مرفوضة", inv.threw);
    const pq = await probe(
      "insert into public.production_queue (order_id, status) values ($1, 'queued')", [orderA.id]);
    check("ودفع طلب إلى التصنيع مرفوض", pq.threw);
    const audit = await probe(
      `insert into public.audit_logs (action, entity) values ('delete', 'orders')`);
    check("والكتابة في سجلّ التدقيق مرفوضة", audit.threw);
    const outbox = await probe(
      `insert into public.staging_outbox (channel, recipient, body) values ('email', 'x@y.z', 'x')`);
    check("والكتابة في صندوق الصادر مرفوضة", outbox.threw);
    const admin = await probe("select public.admin_set_order_status($1, 'ready', 'paid')", [orderA.id]);
    check("والباب الإداري يرفض من ليس مديراً", admin.threw);
    const itemPrice = await probe(
      "update public.order_items set unit_price_fils = 1 where order_id = $1", [orderA.id]);
    check("وتعديل سعر بند مرفوض", itemPrice.threw || itemPrice.rowCount === 0);
  }, { rollback: true });

  const after = await stored(
    `select total_fils, subtotal_fils, discount_fils, payment_status, status
       from public.orders where id = $1`, [orderA.id]);
  eq("الإجمالي المخزَّن لم يتغيّر", after.total_fils, before.total_fils);
  eq("والمجموع كذلك", after.subtotal_fils, before.subtotal_fils);
  eq("والخصم كذلك", after.discount_fils, before.discount_fils);
  eq("وحالة الدفع كذلك", after.payment_status, before.payment_status);
  eq("وحالة الطلب كذلك", after.status, before.status);
  eq("وسعر البند كذلك", Number((await stored(
    "select unit_price_fils from public.order_items where order_id = $1", [orderA.id])).unit_price_fils),
    variant.price_fils);
  eq("ولم تُضف دفعة ثانية", Number((await stored(
    "select count(*)::int as n from public.payments where order_id = $1", [orderA.id])).n), 1);
  eq("ولا حركة مخزون", Number((await stored(
    "select count(*)::int as n from public.inventory_movements")).n), 0);

  // -------------------------------------------------------------------------
  console.log("\n— بند سلة في سلة غيري —");
  // -------------------------------------------------------------------------
  await session(A, async () => {
    const push = await probe(
      `insert into public.cart_items (cart_id, variant_id, quantity, unit_price_fils)
       values ($1, $2, 1, 1)`, [cartB, variant.id]);
    check("أ لا يستطيع الكتابة في سلة ب", push.threw);
    const steal = await probe(
      "update public.cart_items set cart_id = $1 where cart_id = $2", [cartA, cartB]);
    check("ولا سحب بند من سلته", steal.threw || steal.rowCount === 0);
  }, { rollback: true });
  eq("وسلة ب بقيت كما هي", Number((await stored(
    "select count(*)::int as n from public.cart_items where cart_id = $1", [cartB])).n), 0);

  await client.end();
  console.log(failures === 0
    ? "\n✅ المتسوّق المجهول معزول، والسعر من القاعدة، والمفتاح لا يكرّر"
    : `\n❌ ${failures} فشل`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("❌ سقط الاختبار باستثناء:", error);
  process.exit(1);
});
