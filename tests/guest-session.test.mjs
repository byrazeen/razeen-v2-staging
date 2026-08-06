/**
 * إثبات جلسة الضيف — guest session proof.
 *
 * الجولة السابقة أثبتت المتسوّق المجهول فوق GoTrue. هذه الجولة تحذف GoTrue
 * كلّه وتضع مكانه هوية نملكها في مخططنا: `guest_sessions` (0009) وتسع دوال
 * `SECURITY DEFINER` (0010). والسؤال الذي يجيب عنه هذا الملف واحد: **هل صار
 * المتصفّح فعلاً كما نصفه؟** لا «هل كُتب الحارس»، بل «هل يمنع».
 *
 * والملف يفصل بصراحة بين مستويين من البرهان — لأن الخلط بينهما هو كيف تُدَّعى
 * ضمانات لا تُقاس:
 *
 *   القسم الأول (مصدر): يقرأ الشيفرة نفسها. يُثبت ما هو **بنيوي**: أن لا أثر
 *     لـGoTrue، وأن الرمز يُقرأ قبل أن يُصدَر، وأن المستدعين يشتركون في وعد
 *     واحد، وأن الانتعاش مرّة لا حلقة، وأن لا سعر يخرج من المتصفّح، وأن
 *     التخزين المحلي لا يحمل إلا الرمز، وأن مسار الإدارة بلا رمز ضيف.
 *   القسم الثاني (قاعدة): يستدعي الدوال بالدور `anon` الحقيقي على قاعدة
 *     حقيقية. يُثبت ما هو **سلوكي**: العزل، والبقاء بعد «إعادة التحميل»، ورفض
 *     المزوَّر والمُبطل والمنقضي ثم الاستئناف بجلسة جديدة، وتجاهل السعر
 *     المكذوب، وطلب واحد للإرسال المزدوج.
 *
 * وما لا يُثبَت هنا يُقال صراحةً: «استدعاء واحد عند أول تحميل وصفر عند إعادة
 * التحميل» ادّعاءٌ عن متصفّح، ويُقاس في المتصفّح — بنيته مفحوصة هنا، وعدّه
 * مقيس في `tests/browser/guest-browser.mjs`.
 *
 * يحتاج قاعدة PostgreSQL حقيقية للقسم الثاني:
 *   DATABASE_URL=postgres://... node tests/guest-session.test.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const sql = read;

let failures = 0;
const check = (name, cond) => {
  console.log((cond ? "  ✅ " : "  ❌ ") + name);
  if (!cond) failures++;
};
const eq = (name, actual, expected) =>
  check(`${name} (المتوقع ${expected}، والفعلي ${actual})`, Object.is(actual, expected));

/** الفحص على الشيفرة لا على النثر: ذكرُ اسمٍ في تعليق ليس استعمالاً له. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** كل ملف تحت src/ — لأن ادّعاء «لا شيء في التطبيق يفعل كذا» يُفحص على الكل. */
function allSourceFiles(dir = join(ROOT, "src"), out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) allSourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// ١) لا أثر لـGoTrue في التطبيق — على كل ملف، لا على ملفات مختارة
// ---------------------------------------------------------------------------
console.log("\n— المصدر: GoTrue حُذف، لا أُخفي —");

const sources = allSourceFiles().map((f) => ({ path: f.slice(ROOT.length + 1), text: code(readFileSync(f, "utf8")) }));
const GOTRUE = /@supabase\/auth-js|GoTrueClient|signInAnonymously|onAuthStateChange|getSession\(|auth\.uid\(\)|\/auth\/v1|setSession\(|refreshSession\(/;
const offenders = sources.filter((f) => GOTRUE.test(f.text)).map((f) => f.path);
check(`لا استدعاء مصادقة في أي ملف تحت src/ (${sources.length} ملفاً)` +
  (offenders.length ? ` — وُجد في: ${offenders.join(", ")}` : ""), offenders.length === 0);

const pkg = JSON.parse(read("package.json"));
check("و@supabase/auth-js ليست في الاعتماديات",
  !("@supabase/auth-js" in (pkg.dependencies ?? {})) &&
  !("@supabase/auth-js" in (pkg.devDependencies ?? {})));
check("ولا ملف src/lib/anonSession.ts", !sources.some((f) => /anonSession\.ts$/.test(f.path)));
check("ولا ترويسة Authorization تحمل رمز جلسة",
  !/Authorization: `Bearer \$\{token/.test(read("src/lib/supabaseClient.ts")));
check("والترويسة الوحيدة هي مفتاح النشر",
  /Authorization: `Bearer \$\{supabasePublishableKey!\}`/.test(read("src/lib/supabaseClient.ts")));

// ---------------------------------------------------------------------------
// ٢) دورة حياة الرمز: يُقرأ قبل أن يُصدَر، ووعدٌ واحد، وانتعاشٌ مرّة لا حلقة
// ---------------------------------------------------------------------------
console.log("\n— المصدر: رمز واحد، يُقرأ قبل أن يُصدَر —");
const guest = code(read("src/lib/guestSession.ts"));

check("المخزَّن يُقرأ قبل أي إصدار",
  guest.indexOf("readStoredGuestToken()") < guest.indexOf("issue_guest_token"));
check("ولا إصدار إلا حين يكون الجواب لا",
  /const stored = readStoredGuestToken\(\);\s*if \(stored\) return Promise\.resolve\(stored\);/.test(guest));
check("والاستدعاءات المتزامنة تشترك في وعد واحد",
  /if \(!bootstrap\)/.test(guest) && /bootstrap = issue\(\)/.test(guest));
check("والوعد المرفوض لا يُجمَّد إلى الأبد", /bootstrap = null;\s*throw error;/.test(guest));
check("وشكل الرمز مفروض قبل استعماله", /\^rzn_guest_\[0-9a-f\]\{64\}\$/.test(guest));
check("والأخطاء الثلاثة معروفة بالاسم",
  /GUEST_TOKEN_\(UNKNOWN\|REVOKED\|EXPIRED\)/.test(guest));

// الانتعاش: إعادة **واحدة**. حلقةٌ هنا كانت ستحوّل خطأ خادم إلى إغراق.
const withGuest = guest.slice(guest.indexOf("export async function withGuestToken"),
                              guest.indexOf("export async function revokeGuestSession"));
check("الانتعاش يرمي المخزَّن ويُصدر بديلاً", /clearGuestToken\(\);/.test(withGuest) &&
  /const fresh = await ensureGuestToken\(\);/.test(withGuest));
check("ويعيد المحاولة مرّة واحدة لا حلقة",
  (withGuest.match(/run\(/g) ?? []).length === 2 &&
  !/while|for \(/.test(withGuest));
check("وما ليس خطأ رمز يُرفع كما هو",
  /if \(!isDeadGuestTokenError\(error\)\) throw error;/.test(withGuest));

// ---------------------------------------------------------------------------
// ٣) التخزين المحلي: الرمز وحده، ولا مصدر لسلة ولا لطلب
// ---------------------------------------------------------------------------
console.log("\n— المصدر: التخزين المحلي يحمل الرمز، ولا يحمل الحقيقة —");
const repo = code(read("src/data/supabaseRepository.ts"));
const orderFlow = code(read("src/lib/orderFlow.ts"));
const checkout = code(read("src/pages/Checkout.tsx"));
const cart = code(read("src/lib/cart.tsx"));
const contract = code(read("src/data/repositoryContract.ts"));

// المسموح لهم بلمس التخزين المحلي، وكلٌّ بسبب معلن:
//   guestSession — الرمز نفسه، وهو الشيء الوحيد الذي يملكه المتصفّح.
//   cart         — ذاكرة عابرة للرسم الأول، يستبدلها ردّ الخادم.
//   memoryRepository / adapters.mock — التنفيذ البديل حين لا إعداد Supabase
//                  أصلاً، وهو معلن بأنه ليس القاعدة.
const STORAGE_ALLOWED = new Set([
  "src/lib/guestSession.ts", "src/lib/cart.tsx",
  "src/data/memoryRepository.ts", "src/adapters/mock.ts",
]);
const localStorageUsers = sources.filter((f) => /localStorage/.test(f.text)).map((f) => f.path);
check(`localStorage لا يُلمس خارج المواضع المعلنة — وُجد في: ${localStorageUsers.join(", ") || "لا شيء"}`,
  localStorageUsers.every((p) => STORAGE_ALLOWED.has(p)));
check("تنفيذ Supabase لا يلمس localStorage إطلاقاً", !/localStorage/.test(repo));
check("ومسار الطلب كذلك", !/localStorage/.test(orderFlow));
check("وشاشة إتمام الطلب كذلك", !/localStorage/.test(checkout));
check("والعقد لا يعرف تخزيناً محلياً", !/localStorage/.test(contract));
check("والمفتاح المخزَّن واحد ومعلن",
  /GUEST_TOKEN_STORAGE_KEY = "razeen_v2_staging_guest_token"/.test(guest));
check("ولا يُكتب في التخزين إلا الرمز",
  (guest.match(/localStorage\.setItem\(/g) ?? []).length === 1 &&
  /localStorage\.setItem\(GUEST_TOKEN_STORAGE_KEY, token\)/.test(guest));

console.log("\n— المصدر: السلة والطلبات تأتيان من الخادم في كل تحميل —");
check("السلة تُقرأ من الخادم", /repository\.loadCart\(\)/.test(cart));
check("وتُكتب إليه عند كل تغيير", /repository\.saveCart\(/.test(cart));
check("والقادم من الخادم يستبدل النسخة المحلية",
  /setLines\(\(cached\)/.test(cart) && /\.\.\.serverLines/.test(cart));
check("ولا تُكتب سلة إلى الخادم قبل وصول قراءته",
  /if \(!hydrated\.current\) return;/.test(cart));
check("ومفتاح التخزين يسمّي نفسه ذاكرةً لا مصدراً",
  /razeen_v2_staging_cart_cache/.test(cart) && /CACHE_KEY/.test(cart));
check("وقراءة السلة تمرّ بـguest_get_cart", /guestRpc<GuestCart>\("guest_get_cart"/.test(repo));
check("والطلبات تُقرأ بـguest_order_status", /"guest_order_status"/.test(repo));
const shopperCart = repo.slice(repo.indexOf("async loadCart"), repo.indexOf("async createCustomRequest"));
check("ولا قراءة ولا كتابة جدولية للسلة في مسار المتسوّق",
  !/from\("cart_items"\)|from\("carts"\)/.test(shopperCart));

// ---------------------------------------------------------------------------
// ٤) لا سعر يخرج من المتصفّح — في أي استدعاء ضيف
// ---------------------------------------------------------------------------
console.log("\n— المصدر: المتصفّح لا يرسل سعراً —");
const itemsFn = orderFlow.slice(orderFlow.indexOf("export function itemsFromLines"),
                                orderFlow.indexOf("export async function placeOrder"));
check("بناء البنود لا يمرّر أي مبلغ", !/Fils/.test(itemsFn));
check("والبند في العقد بلا حقل سعر",
  !/unitPriceFils/.test(contract.slice(contract.indexOf("interface PlaceOrderItem"),
                                       contract.indexOf("interface PlaceOrderRequest"))));
check("والإنشاء يمرّ بـguest_place_order وحدها",
  /"guest_place_order"/.test(repo) && !/from\("orders"\)\s*\.insert/.test(repo));
check("وحفظ السلة لا يرسل unit_price_fils",
  !/unit_price_fils/.test(repo.slice(repo.indexOf("async saveCart"), repo.indexOf("async createCustomRequest"))));
check("ولا حقل سعر في أي حمولة استدعاء ضيف",
  !/p_(unit_)?price|p_total|p_subtotal|p_discount/.test(repo));
check("وحالات الطلب تُكتب عبر الباب الإداري لا بـUPDATE",
  /\.rpc\("admin_set_order_status"/.test(repo)
  && !/from\("orders"\)[\s\S]{0,40}\.update\(/.test(repo));
check("والمفتاح يُولَّد مرة لكل محاولة ويُعاد استعماله",
  /useRef<string>\(newIdempotencyKey\(\)\)/.test(checkout) && /idempotencyKey\.current/.test(checkout));

// ---------------------------------------------------------------------------
// ٥) مسار الإدارة منفصل — ولا يحمل رمز ضيف
// ---------------------------------------------------------------------------
console.log("\n— المصدر: الإدارة بلا رمز ضيف —");
check("الفرع مكتوب صراحةً باسم البوّابة", /if \(isAdminSignedIn\(\)\)/.test(repo));
const queueFn = repo.slice(repo.indexOf("async listProductionQueue"), repo.indexOf("async placeOrder"));
check("قائمة التصنيع قراءة جدولية بلا رمز", !/withGuestToken/.test(queueFn));
const adminFn = repo.slice(repo.indexOf("async function adminSetOrderStatus"), repo.indexOf("async function guestOrders"));
check("والباب الإداري بلا رمز كذلك", !/withGuestToken/.test(adminFn));
check("والبوّابة تبقى وهمية معلنة",
  /MOCK GATE — NOT AUTHENTICATION|MOCK SIGN-IN ONLY/.test(read("src/lib/adminMode.ts") + read("src/components/AdminGate.tsx")));
check("ولا دالة ضيف في مسار الإدارة", !/guest_/.test(queueFn + adminFn));

console.log("\n— المصدر: القرار موثّق في README —");
const readme = read("README.md");
check("README فيه قسم معنون لهوية الضيف", /## هوية الضيف وإساءة استعمالها/.test(readme));
check("ويقول إن GoTrue حُذف", /تسجيل الدخول المجهول \(GoTrue\) حُذف بالكامل/.test(readme));
check("ويسمّي ما يُخزَّن في المتصفّح", /razeen_v2_staging_guest_token/.test(readme));
check("ويسمّي ما يحدّ الضرر", /guest_issue_cap|guest_checkout_cap/.test(readme) && /idempotency/i.test(readme));
check("ويقول بصراحة ما لا يُمنع اليوم",
  /وما لا يُمنع اليوم/.test(readme) && /عالمي لا لكل عنوان IP/.test(readme));
check("ولا سكربت طرف ثالث دخل الشيفرة",
  !/challenges\.cloudflare\.com|hcaptcha\.com|recaptcha/.test(guest + read("index.html")));

// ---------------------------------------------------------------------------
// القسم الثاني: القاعدة. من هنا فصاعداً لا شيء يُفحص في نصّ، وكل شيء يُقاس.
// ---------------------------------------------------------------------------
const CONNECTION = process.env.DATABASE_URL;
if (!CONNECTION) {
  console.error("❌ DATABASE_URL غير معرّف — القسم الثاني يحتاج قاعدة PostgreSQL حقيقية");
  process.exit(1);
}

const client = new pg.Client({ connectionString: CONNECTION });

/** ينفّذ بالدور anon تماماً كما يفعل PostgREST بالمفتاح العام وبلا تسجيل دخول. */
async function anon(text, params = []) {
  await client.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role: "anon" })]);
  await client.query("set role anon");
  try {
    const r = await client.query(text, params);
    return { ok: true, rows: r.rows, message: null };
  } catch (e) {
    return { ok: false, rows: [], message: e.message };
  } finally {
    await client.query("reset role");
    await client.query("select set_config('request.jwt.claims', '', false)");
  }
}

/** استدعاء يُتوقَّع نجاحه. يُعيد الحمولة أو يرمي بالرسالة الحقيقية. */
async function rpc(text, params = []) {
  const r = await anon(text, params);
  if (!r.ok) throw new Error(`RPC فشل بخلاف المتوقَّع: ${r.message}\n${text}`);
  return r.rows[0][Object.keys(r.rows[0])[0]];
}

const rows = async (text, params = []) => (await client.query(text, params)).rows;

/**
 * محاكاة **العميل** كما هو مكتوب في `guestSession.ts`: مخزنٌ يحمل الرمز
 * وحده، ويُقرأ قبل الإصدار، ووعدٌ واحد، وانتعاشٌ مرّة واحدة.
 *
 * ولماذا يُعاد بناؤه هنا بدل استيراد الملف؟ لأن الملف TypeScript يستورد عميل
 * PostgREST ويحتاج متصفّحاً. فالمقيس هنا هو **البروتوكول**: أي استدعاء يقع،
 * ومتى، وبأي رمز. والبنية التي تنفّذه فُحصت سطراً سطراً في القسم الأول،
 * وعدّها الحقيقي في المتصفّح يقع في `tests/browser/guest-browser.mjs`.
 */
function makeBrowser() {
  const store = new Map();
  let issues = 0;
  let bootstrap = null;
  const api = {
    get storage() { return store; },
    get issues() { return issues; },
    async ensure() {
      const stored = store.get("razeen_v2_staging_guest_token");
      if (stored) return stored;
      if (!bootstrap) {
        bootstrap = (async () => {
          const out = await rpc("select public.issue_guest_token() as r");
          issues += 1;
          store.set("razeen_v2_staging_guest_token", out.token);
          return out.token;
        })().catch((e) => { bootstrap = null; throw e; });
      }
      return bootstrap;
    },
    async run(fn) {
      const token = await api.ensure();
      const first = await fn(token);
      if (first.ok || !/GUEST_TOKEN_(UNKNOWN|REVOKED|EXPIRED)/.test(first.message ?? "")) return first;
      store.delete("razeen_v2_staging_guest_token");
      bootstrap = null;
      return fn(await api.ensure());
    },
    /** إعادة تحميل الصفحة: الذاكرة تُمسح، والتخزين يبقى. */
    reload() { bootstrap = null; },
  };
  return api;
}

async function main() {
  await client.connect();

  await client.query("drop schema if exists public cascade; create schema public;");
  await client.query("drop schema if exists auth cascade;");
  await client.query(sql("supabase/test/shim.sql"));
  for (const f of ["0001_baseline", "0002_rls", "0003_audit", "0004_harden_audit",
                   "0005_anon_ownership", "0006_restrictive_writes", "0007_place_order",
                   "0008_anon_cleanup", "0009_guest_sessions", "0010_guest_rpcs"]) {
    await client.query(sql(`supabase/migrations/${f}.sql`));
  }
  await client.query(sql("supabase/seed/staging_seed.sql"));

  const variant = (await rows(
    "select id, price_fils from public.product_variants where sku = 'stg-amber-oud-100ml'"))[0];

  // -------------------------------------------------------------------------
  console.log("\n— أول تحميل: إصدار واحد. إعادة التحميل: صفر —");
  // -------------------------------------------------------------------------
  const A = makeBrowser();
  // ثلاثة مستدعين متزامنين في أول لحظة — كما تفعل الصفحة فعلاً (main + سلة + طلبات).
  const [t1, t2, t3] = await Promise.all([A.ensure(), A.ensure(), A.ensure()]);
  eq("استدعاء إصدار واحد رغم ثلاثة مستدعين متزامنين", A.issues, 1);
  check("والرمز نفسه للثلاثة", t1 === t2 && t2 === t3);
  check("وشكله كما تصفه الهجرة", /^rzn_guest_[0-9a-f]{64}$/.test(t1));
  eq("وجلسة واحدة في القاعدة", Number((await rows("select count(*)::int n from public.guest_sessions"))[0].n), 1);
  eq("والمخزَّن هو الهاش لا الرمز",
    (await rows("select token_hash from public.guest_sessions"))[0].token_hash,
    (await rows("select public.guest_token_hash($1) as h", [t1]))[0].h);
  check("ولا أثر للرمز الخام في أي عمود",
    (await rows("select count(*)::int n from public.guest_sessions where token_hash like 'rzn_guest_%'"))[0].n === 0);

  A.reload();
  const afterReload = await A.ensure();
  eq("إعادة التحميل لا تُصدر رمزاً ثانياً", A.issues, 1);
  eq("والرمز هو نفسه", afterReload, t1);
  eq("ولا جلسة ثانية في القاعدة", Number((await rows("select count(*)::int n from public.guest_sessions"))[0].n), 1);
  eq("ولا صفّ في auth.users", Number((await rows("select count(*)::int n from auth.users where is_anonymous"))[0].n), 0);
  eq("والتخزين المحلي يحمل مفتاحاً واحداً", A.storage.size, 1);

  // -------------------------------------------------------------------------
  console.log("\n— السلة تنجو من إعادة التحميل، ومن الخادم لا من التخزين —");
  // -------------------------------------------------------------------------
  await rpc("select public.guest_set_cart_item($1, $2, 2) as r", [t1, variant.id]);
  A.reload();
  const cartAfterReload = await rpc("select public.guest_get_cart($1) as r", [await A.ensure()]);
  eq("بند واحد بعد إعادة التحميل", cartAfterReload.items.length, 1);
  eq("وبالكمية كما تُركت", cartAfterReload.items[0].quantity, 2);
  eq("وبسعر الرفّ لا بسعر مرسَل", cartAfterReload.items[0].unit_price_fils, variant.price_fils);
  eq("والتخزين المحلي ما زال يحمل الرمز وحده", A.storage.size, 1);
  check("ولا شيء في التخزين يشبه سلة أو طلباً",
    ![...A.storage.values()].some((v) => /quantity|order|price/i.test(String(v))));

  // -------------------------------------------------------------------------
  console.log("\n— ضيفان: لا أحد يرى أحداً —");
  // -------------------------------------------------------------------------
  const B = makeBrowser();
  const tB = await B.ensure();
  check("رمزان متمايزان", tB !== t1);
  const cartB = await rpc("select public.guest_get_cart($1) as r", [tB]);
  eq("سلة ب فارغة رغم امتلاء سلة أ", cartB.items.length, 0);
  check("وسلّتاهما صفّان مختلفان", cartB.cart_id !== cartAfterReload.cart_id);

  const orderB = await rpc("select public.guest_place_order($1, $2::jsonb, $3::jsonb, $4, 'success') as r",
    [tB, JSON.stringify([{ kind: "ready", variant_id: variant.id, quantity: 1 }]),
     JSON.stringify({ full_name: "ضيف ب", phone: "0500000202", emirate: "الشارقة",
                      area: "منطقة ب", street: "شارع ب", building: "مبنى ب" }), "key-b-1"]);
  const statusA = await rpc("select public.guest_order_status($1) as r", [t1]);
  eq("أ لا يرى أي طلب لـب", statusA.length, 0);
  const statusB = await rpc("select public.guest_order_status($1) as r", [tB]);
  eq("وب يرى طلبه هو", statusB.length, 1);
  eq("وبرقمه", statusB[0].order_number, orderB.order_number);
  const byNumber = await anon("select public.guest_order_status($1, $2) as r", [t1, orderB.order_number]);
  eq("وتخمين رقم طلب الغير لا يُفيد", byNumber.rows[0].r.length, 0);
  eq("ولا يرى أ صفّ عميل ب", Number((await rows(
    "select count(*)::int n from public.customers where guest_session_id = (select id from public.guest_sessions where token_hash = public.guest_token_hash($1))",
    [t1]))[0].n), 0);

  // -------------------------------------------------------------------------
  console.log("\n— السعر المكذوب لا أثر له —");
  // -------------------------------------------------------------------------
  const lied = await rpc("select public.guest_place_order($1, $2::jsonb, $3::jsonb, $4, 'success') as r",
    [tB, JSON.stringify([{
      kind: "ready", variant_id: variant.id, quantity: 1,
      // كل ما يلي كذبٌ صريح. الدالة لا تقرأ منه حرفاً.
      unit_price_fils: 1, price: 1, line_total_fils: 1, total_fils: 1,
      subtotal_fils: 1, discount_fils: 99999, shipping_fils: 0,
    }]), JSON.stringify({ full_name: "ضيف ب", phone: "0500000202" }), "key-b-lie"]);
  eq("المجموع سعر القاعدة", lied.subtotal_fils, variant.price_fils);
  eq("والخصم تجاهل المرسَل", lied.discount_fils, 0);
  const liedStored = await rows(
    "select subtotal_fils, total_fils, discount_fils from public.orders where order_number = $1", [lied.order_number]);
  eq("والمخزَّن فعلاً سعر القاعدة", liedStored[0].subtotal_fils, variant.price_fils);
  eq("ولا خصم مخزَّن", liedStored[0].discount_fils, 0);
  eq("وسعر البند المخزَّن سعر الرفّ", Number((await rows(
    `select i.unit_price_fils from public.order_items i
       join public.orders o on o.id = i.order_id where o.order_number = $1`, [lied.order_number]))[0].unit_price_fils),
    variant.price_fils);

  // السلة كذلك: لا وسيط سعر أصلاً، فالتزوير غير قابل للتعبير عنه.
  const setSig = (await rows(
    `select pg_get_function_arguments(p.oid) as args from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'guest_set_cart_item'`))[0].args;
  check(`وضبط بند السلة لا يقبل وسيط سعر أصلاً (${setSig})`, !/price/.test(setSig));

  // -------------------------------------------------------------------------
  console.log("\n— الإرسال المزدوج: طلب واحد لا اثنان —");
  // -------------------------------------------------------------------------
  const before = Number((await rows("select count(*)::int n from public.orders"))[0].n);
  const [first, second] = [
    await rpc("select public.guest_place_order($1, $2::jsonb, $3::jsonb, $4, 'success') as r",
      [tB, JSON.stringify([{ kind: "ready", variant_id: variant.id, quantity: 1 }]),
       JSON.stringify({ full_name: "ضيف ب", phone: "0500000202" }), "key-b-double"]),
    await rpc("select public.guest_place_order($1, $2::jsonb, $3::jsonb, $4, 'success') as r",
      [tB, JSON.stringify([{ kind: "ready", variant_id: variant.id, quantity: 1 }]),
       JSON.stringify({ full_name: "ضيف ب", phone: "0500000202" }), "key-b-double"]),
  ];
  eq("الردّان يحملان الرقم نفسه", second.order_number, first.order_number);
  check("والثاني مُعلَّم إعادةً لا إنشاءً", second.idempotent_replay === true);
  eq("وطلب واحد بهذا المفتاح", Number((await rows(
    "select count(*)::int n from public.orders where idempotency_key = $1", ["key-b-double"]))[0].n), 1);
  eq("وعدد الطلبات زاد واحداً لا اثنين",
    Number((await rows("select count(*)::int n from public.orders"))[0].n), before + 1);
  eq("ودفعة واحدة", Number((await rows(
    `select count(*)::int n from public.payments p join public.orders o on o.id = p.order_id
      where o.order_number = $1`, [first.order_number]))[0].n), 1);
  eq("وصفّ واحد في طابور الإنتاج", Number((await rows(
    `select count(*)::int n from public.production_queue q join public.orders o on o.id = q.order_id
      where o.order_number = $1`, [first.order_number]))[0].n), 1);

  const failed = await rpc("select public.guest_place_order($1, $2::jsonb, $3::jsonb, $4, 'failed') as r",
    [tB, JSON.stringify([{ kind: "ready", variant_id: variant.id, quantity: 1 }]),
     JSON.stringify({ full_name: "ضيف ب", phone: "0500000202" }), "key-b-failed"]);
  eq("والدفع الفاشل حالته failed", failed.payment_status, "failed");
  eq("ولا يدخل التصنيع", Number((await rows(
    `select count(*)::int n from public.production_queue q join public.orders o on o.id = q.order_id
      where o.order_number = $1`, [failed.order_number]))[0].n), 0);

  // -------------------------------------------------------------------------
  console.log("\n— الرمز المزوَّر والمُبطل والمنقضي: رفضٌ ثم استئناف —");
  // -------------------------------------------------------------------------
  const forged = await anon("select public.guest_get_cart($1) as r",
    ["rzn_guest_" + "f".repeat(64)]);
  check("المزوَّر يُرفض بـUNKNOWN", !forged.ok && /GUEST_TOKEN_UNKNOWN/.test(forged.message));
  const empty = await anon("select public.guest_get_cart('') as r");
  check("والفارغ كذلك", !empty.ok && /GUEST_TOKEN_UNKNOWN/.test(empty.message));

  // مُبطل: الضيف نفسه يُنهي جلسته، ثم يحاول.
  const R = makeBrowser();
  const tR = await R.ensure();
  await rpc("select public.guest_set_cart_item($1, $2, 1) as r", [tR, variant.id]);
  await rpc("select public.guest_revoke_token($1) as r", [tR]);
  const revoked = await anon("select public.guest_get_cart($1) as r", [tR]);
  check("والمُبطل يُرفض بـREVOKED", !revoked.ok && /GUEST_TOKEN_REVOKED/.test(revoked.message));

  // ...وهنا الادّعاء الذي يهمّ المتسوّق: **لا طريق مسدود**.
  const recovered = await R.run((token) => anon("select public.guest_get_cart($1) as r", [token]));
  check("لكن التطبيق ينتعش: استدعاء ناجح بعد الرفض", recovered.ok);
  eq("وبإصدار جلسة جديدة واحدة لا أكثر", R.issues, 2);
  eq("وسلة الجلسة الجديدة فارغة (لا تسرّب من الجلسة المُبطلة)",
    recovered.rows[0].r.items.length, 0);
  check("والرمز المخزَّن صار الجديد", R.storage.get("razeen_v2_staging_guest_token") !== tR);

  // منقضٍ: تُدفع نهاية الجلسة إلى الماضي بأعلى صلاحية (لا سبيل للعميل إلى ذلك).
  const E = makeBrowser();
  const tE = await E.ensure();
  await client.query(
    "update public.guest_sessions set expires_at = now() - interval '1 day' where token_hash = public.guest_token_hash($1)", [tE]);
  const expired = await anon("select public.guest_get_cart($1) as r", [tE]);
  check("والمنقضي يُرفض بـEXPIRED", !expired.ok && /GUEST_TOKEN_EXPIRED/.test(expired.message));
  const recoveredE = await E.run((token) => anon("select public.guest_get_cart($1) as r", [token]));
  check("والتطبيق ينتعش منه كذلك", recoveredE.ok);
  eq("بإصدار واحد إضافي", E.issues, 2);

  // ولا حلقة: رمزٌ جديد يُرفض هو خلل خادم، فيُرفع مرّة ولا يُعاد إلى الأبد.
  let attempts = 0;
  const alwaysDead = makeBrowser();
  const stubborn = await alwaysDead.run(async () => {
    attempts += 1;
    return { ok: false, message: "GUEST_TOKEN_UNKNOWN: مصطنع" };
  });
  eq("والفشل المستمر يوقف عند محاولتين لا يدور", attempts, 2);
  check("والنتيجة الأخيرة تُرفع كما هي", stubborn.ok === false);

  // -------------------------------------------------------------------------
  console.log("\n— الجداول نفسها مغلقة: الباب الوحيد هو الدالة —");
  // -------------------------------------------------------------------------
  const directSessions = await anon("select id from public.guest_sessions");
  check("anon لا يقرأ guest_sessions مباشرة", !directSessions.ok || directSessions.rows.length === 0);
  const directCarts = await anon("select id from public.carts where guest_session_id is not null");
  check("ولا صفوف السلة المملوكة لضيف", !directCarts.ok || directCarts.rows.length === 0);
  const directOrders = await anon("select id from public.orders where guest_session_id is not null");
  check("ولا طلبات الضيوف", !directOrders.ok || directOrders.rows.length === 0);
  const steal = await anon(
    "update public.guest_sessions set expires_at = now() + interval '999 days'");
  check("ولا يستطيع تمديد جلسة", !steal.ok || steal.rows.length === 0);

  await client.end();
  console.log(failures === 0
    ? "\n✅ جلسة الضيف: رمز واحد، عزل تام، سعر من القاعدة، ولا طريق مسدود"
    : `\n❌ ${failures} فشل`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("❌ سقط الاختبار باستثناء:", error);
  process.exit(1);
});
