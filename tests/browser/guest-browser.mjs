/**
 * إثبات في المتصفّح — ما لا يُقاس إلا بتشغيل التطبيق نفسه.
 *
 * القسم المصدري في `tests/guest-session.test.mjs` يفحص البنية، والقسم
 * القاعدي يفحص ما تسمح به القاعدة. يبقى ادّعاءٌ ثالث لا يُثبته أيٌّ منهما:
 * **كم استدعاء `issue_guest_token` يقع فعلاً عند أول تحميل، وكم يقع عند
 * إعادة التحميل؟** هذا سؤال عن تطبيق يعمل، فيُقاس على تطبيق يعمل.
 *
 * ⚠️ **النقل معترَض، والاعتراف صريح.** هذه البيئة المعزولة لا تصل إلى
 * `*.supabase.co` إطلاقاً (كل طلب يُردّ بـ403 عند الوسيط). فكل نداء إلى
 * `**​/rest/v1/**` يُلبّى هنا بردٍّ مصنوع **بالشكل نفسه الذي تعيده دوال 0010
 * حرفياً** — والمقيس هو شيفرة العميل الحقيقية فوقه: متى تستدعي، وبأي رمز،
 * وكم مرّة، وماذا تحفظ. ما لا يثبته هذا الملف: أن الخادم الحقيقي يردّ بذلك.
 * ذاك يثبته القسم القاعدي على PostgreSQL حقيقية.
 *
 * التشغيل (يحتاج حزمة مبنية بمتغيّرات staging، وplaywright في أي مسار):
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright/index.mjs \
 *   node tests/browser/guest-browser.mjs
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST = join(ROOT, "dist");

let failures = 0;
const check = (name, cond) => {
  console.log((cond ? "  ✅ " : "  ❌ ") + name);
  if (!cond) failures++;
};
const eq = (name, actual, expected) =>
  check(`${name} (المتوقع ${expected}، والفعلي ${actual})`, Object.is(actual, expected));

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
               ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp",
               ".json": "application/json", ".txt": "text/plain", ".ico": "image/x-icon" };

/** خادم ملفات ساكن للحزمة المبنية، مع إعادة توجيه المسارات إلى index.html. */
function serve() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = req.url.split("?")[0];
      let file = join(DIST, url === "/" ? "index.html" : url.slice(1));
      if (!existsSync(file) || url === "/") file = join(DIST, "index.html");
      if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(readFileSync(file));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

// ---------------------------------------------------------------------------
// الخادم المصنوع: أشكال الردود منقولة حرفياً عن 0010_guest_rpcs.sql.
// ---------------------------------------------------------------------------
const VARIANT = "11111111-2222-4333-8444-555555555555";
const hex = (n) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

function makeBackend() {
  const state = {
    issued: [],                  // كل رمز أُصدر، بالترتيب
    sessions: new Map(),         // token -> { cart: Map(variant->qty), orders: [] }
    calls: [],                   // كل استدعاء وقع، بالاسم
    orderSeq: 1000,
    idempotency: new Map(),      // key -> order
  };

  const cartOf = (token) => {
    const s = state.sessions.get(token);
    return {
      cart_id: "cart-" + (token ?? "").slice(-6),
      items: [...s.cart.entries()].map(([variant_id, quantity], i) => ({
        item_id: `item-${i}`, kind: "ready", variant_id, custom_request_id: null,
        title: "عود العنبر · 100ml", quantity, unit_price_fils: 28900,
        created_at: "2026-01-0" + (i + 1) + "T00:00:00Z",
      })),
    };
  };

  return {
    state,
    handle(fn, body) {
      state.calls.push(fn);
      const token = body?.p_token;
      if (fn === "issue_guest_token") {
        const t = "rzn_guest_" + hex(64);
        state.issued.push(t);
        state.sessions.set(t, { cart: new Map(), orders: [] });
        return { token: t, session_id: hex(8), expires_at: "2026-12-31T00:00:00Z" };
      }
      // كل دالة أخرى تتحقّق من الرمز أولاً — كما تفعل القاعدة حرفياً.
      if (!state.sessions.has(token)) {
        return { __error: { message: "GUEST_TOKEN_UNKNOWN: لا جلسة ضيف بهذا الرمز", code: "42501" } };
      }
      const s = state.sessions.get(token);
      switch (fn) {
        case "guest_get_cart": return cartOf(token);
        case "guest_clear_cart": s.cart.clear(); return cartOf(token);
        case "guest_set_cart_item":
          if (body.p_quantity === 0) s.cart.delete(body.p_variant_id);
          else s.cart.set(body.p_variant_id, body.p_quantity);
          return cartOf(token);
        case "guest_place_order": {
          const key = body.p_idempotency_key;
          if (state.idempotency.has(key)) {
            return { ...state.idempotency.get(key), idempotent_replay: true };
          }
          const qty = (body.p_items ?? []).reduce((n, i) => n + i.quantity, 0);
          const subtotal = 28900 * qty;
          const order = {
            order_id: hex(8), order_number: "STG-" + ++state.orderSeq,
            status: "paid", payment_status: "paid",
            subtotal_fils: subtotal, discount_fils: 0, shipping_fils: 2500,
            total_fils: subtotal + 2500, currency: "AED",
            placed_at: new Date().toISOString(),
            items: (body.p_items ?? []).map((i) => ({
              title: "عود العنبر · 100ml", quantity: i.quantity,
              unit_price_fils: 28900, line_total_fils: 28900 * i.quantity,
            })),
          };
          state.idempotency.set(key, order);
          s.orders.push(order);
          s.cart.clear();
          return { ...order, idempotent_replay: false };
        }
        case "guest_order_status":
          return body.p_order_number
            ? s.orders.filter((o) => o.order_number === body.p_order_number)
            : [...s.orders].reverse();
        case "guest_list_custom_requests": return [];
        default: return null;
      }
    },
  };
}

/** الرفّ العام: قراءة جدولية عادية، تُلبّى بصفوف مصنوعة. */
function shelfFor(url) {
  if (url.includes("/products")) {
    return [{
      handle: "amber-oud", title_ar: "عود العنبر", title_en: null, family: "woody",
      intensity: 3, base_price_fils: 28900, currency: "AED", is_available: true, is_vip: false,
      aliases: null, product_variants: [{ stock_qty: 12, is_active: true, price_fils: 28900 }],
    }];
  }
  if (url.includes("/product_variants")) {
    return [{ id: VARIANT, product_id: "p1", sku: "amber-oud-100ml", bottle_size: "100ml",
              price_fils: 28900, stock_qty: 12, is_active: true,
              products: { handle: "amber-oud", title_ar: "عود العنبر" } }];
  }
  if (url.includes("/perfume_catalog")) {
    return [{ code: "STG-001", inspired_brand: "علامة تجريبية", perfume_name: "زيت تجريبي",
              kilo_price_fils: 120000 }];
  }
  return [];
}

async function run() {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-sandbox"],
  });

  const backend = makeBackend();
  const external = [];   // كل طلب غادر إلى مضيف ليس خادمنا المحلي
  const seenUrls = [];   // كل رابط طُلب، أياً كان مصيره

  async function newContext(viewport) {
    const ctx = await browser.newContext({ viewport });
    await ctx.route("**/*", async (route) => {
      const req = route.request();
      const url = req.url();
      seenUrls.push(url);
      if (url.startsWith(origin)) return route.continue();

      if (url.includes("/rest/v1/rpc/")) {
        const fn = url.split("/rest/v1/rpc/")[1].split("?")[0];
        const body = req.postDataJSON?.() ?? {};
        const out = backend.handle(fn, body);
        if (out && out.__error) {
          return route.fulfill({ status: 400, contentType: "application/json",
                                 body: JSON.stringify(out.__error) });
        }
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(out) });
      }
      if (url.includes("/rest/v1/")) {
        return route.fulfill({ status: 200, contentType: "application/json",
                               body: JSON.stringify(shelfFor(url)) });
      }
      // أي شيء آخر خارج خادمنا = طلب طرف ثالث. يُسجَّل ويُحبَط.
      external.push(url);
      return route.abort();
    });
    return ctx;
  }

  for (const [label, viewport] of [["٣٩٠px (هاتف)", { width: 390, height: 844 }],
                                   ["١٤٤٠px (سطح مكتب)", { width: 1440, height: 900 }]]) {
    console.log(`\n— ${label} —`);
    const before = backend.state.calls.filter((c) => c === "issue_guest_token").length;
    const ctx = await newContext(viewport);
    const page = await ctx.newPage();

    await page.goto(`${origin}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);

    const issuedFirst = backend.state.calls.filter((c) => c === "issue_guest_token").length - before;
    eq("أول تحميل: استدعاء إصدار واحد", issuedFirst, 1);

    const stored = await page.evaluate(() => Object.entries(localStorage).map(([k, v]) => [k, v]));
    const tokenEntry = stored.find(([k]) => k === "razeen_v2_staging_guest_token");
    check("والرمز محفوظ في localStorage", Boolean(tokenEntry));
    check("وشكله كما تصفه الهجرة", /^rzn_guest_[0-9a-f]{64}$/.test(tokenEntry?.[1] ?? ""));
    check("ولا مفتاح جلسة GoTrue في التخزين",
      !stored.some(([k]) => /auth|gotrue|sb-/.test(k)));

    // شريط STAGING ظاهر — على المقاسين.
    const banner = page.locator("text=STAGING").first();
    check("وشريط STAGING ظاهر", await banner.isVisible());

    // إعادة التحميل: صفر إصدار.
    const beforeReload = backend.state.calls.filter((c) => c === "issue_guest_token").length;
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    eq("إعادة التحميل: صفر إصدار",
      backend.state.calls.filter((c) => c === "issue_guest_token").length - beforeReload, 0);
    const after = await page.evaluate(() => localStorage.getItem("razeen_v2_staging_guest_token"));
    eq("والرمز هو نفسه", after, tokenEntry?.[1]);

    // السلة: تُضاف ثم تنجو من إعادة تحميل — من الخادم لا من التخزين.
    await page.goto(`${origin}/product/amber-oud`, { waitUntil: "networkidle" });
    const addButton = page.locator("button", { hasText: /أضف|السلة/ }).first();
    if (await addButton.count()) {
      await addButton.click();
      await page.waitForTimeout(500);
    }
    const serverQty = [...backend.state.sessions.values()]
      .reduce((n, s) => n + [...s.cart.values()].reduce((a, b) => a + b, 0), 0);
    check(`السلة وصلت الخادم (كمية ${serverQty})`, serverQty > 0);

    // التخزين المحلي يُفرَّغ من ذاكرة السلة عمداً: ما يُعرض بعدها هو ردّ الخادم.
    await page.evaluate(() => localStorage.removeItem("razeen_v2_staging_cart_cache"));
    await page.goto(`${origin}/cart`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const cartText = await page.locator("body").innerText();
    check("والسلة نجت من إعادة التحميل بلا ذاكرة محلية", /عود العنبر/.test(cartText));

    await ctx.close();
  }

  // -------------------------------------------------------------------------
  console.log("\n— الإرسال المزدوج: طلب واحد —");
  // -------------------------------------------------------------------------
  const ordersBefore = backend.state.idempotency.size;
  const ctx = await newContext({ width: 390, height: 844 });
  const page = await ctx.newPage();

  // رحلة كاملة: رفّ ⇒ عطر ⇒ سلة ⇒ إتمام الطلب، ثم **نقرتان** على زرّ الدفع.
  await page.goto(`${origin}/product/amber-oud`, { waitUntil: "networkidle" });
  const add = page.locator("button", { hasText: /أضف|السلة/ }).first();
  if (await add.count()) { await add.click(); await page.waitForTimeout(400); }

  await page.goto(`${origin}/checkout`, { waitUntil: "networkidle" });
  await page.fill("#name", "ضيف تجريبي");
  await page.fill("#phone", "0501234567");
  await page.selectOption("#emirate", { index: 1 }).catch(() => {});
  await page.fill("#area", "منطقة تجريبية");
  await page.fill("#street", "شارع تجريبي");
  await page.fill("#building", "مبنى ١");

  const submit = page.locator('button[type="submit"]').first();
  // نقرتان متتاليتان بلا انتظار — بالضبط ما يفعله إصبعٌ متردّد على شبكة بطيئة.
  await Promise.all([
    submit.click({ force: true }),
    submit.click({ force: true }).catch(() => {}),
  ]);
  await page.waitForTimeout(1200);

  const placeCalls = backend.state.calls.filter((c) => c === "guest_place_order").length;
  const created = backend.state.idempotency.size - ordersBefore;
  check(`النقرتان أنتجتا طلباً واحداً (استدعاءات الدفع: ${placeCalls})`, created === 1);
  const keys = [...backend.state.idempotency.keys()];
  check("والمفتاح واحد لا اثنان", new Set(keys).size === keys.length && created === 1);

  // -------------------------------------------------------------------------
  console.log("\n— لا طرف ثالث —");
  // -------------------------------------------------------------------------
  const thirdParty = external.filter((u) => !u.startsWith("data:") && !u.startsWith("blob:"));
  check(`صفر طلب إلى طرف ثالث${thirdParty.length ? ": " + thirdParty.join(", ") : ""}`,
    thirdParty.length === 0);
  const gotrue = seenUrls.filter((u) => /\/auth\/v1|signup|signin|\/token\?grant_type/i.test(u));
  check(`ولا طلب إلى GoTrue إطلاقاً${gotrue.length ? ": " + gotrue.join(", ") : ""}`, gotrue.length === 0);
  const rpcNames = [...new Set(backend.state.calls)];
  check(`والدوال المستدعاة كلها دوال ضيف: ${rpcNames.join(", ")}`,
    rpcNames.every((n) => n === "issue_guest_token" || n.startsWith("guest_")));

  await ctx.close();
  await browser.close();
  server.close();

  console.log(failures === 0
    ? "\n✅ المتصفّح: رمز واحد عند أول تحميل، صفر عند إعادته، والسلة من الخادم"
    : `\n❌ ${failures} فشل`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error("❌ سقط الاختبار باستثناء:", e); process.exit(1); });
