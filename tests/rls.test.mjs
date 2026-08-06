/**
 * RLS proof suite for the RAZEEN V2 staging baseline.
 *
 * A policy file is only worth what a hostile query can prove about it, so every
 * case below is a REAL query issued as a REAL role. Nothing is asserted about
 * the SQL text; everything is asserted about what the database allowed.
 *
 * How it runs:
 *   1. resets the public schema
 *   2. applies supabase/test/shim.sql  — auth schema + auth.uid() + the three
 *      Supabase roles, so the policies run UNMODIFIED against plain Postgres
 *   3. applies supabase/migrations/*.sql in order, then the staging seed
 *   4. impersonates users with SET LOCAL ROLE + request.jwt.claims, exactly the
 *      mechanism PostgREST uses on Supabase
 *
 * Needs a plain PostgreSQL database:  DATABASE_URL=postgres://... node tests/rls.test.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql = (p) => readFileSync(join(ROOT, p), "utf8");

const CONNECTION = process.env.DATABASE_URL;
if (!CONNECTION) {
  console.error("❌ DATABASE_URL غير معرّف — هذا الاختبار يحتاج قاعدة PostgreSQL حقيقية");
  process.exit(1);
}

/** Seed identities. These uuids are written literally in staging_seed.sql. */
const NOURA_UID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"; // customer A
const SALEM_UID = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"; // customer B
const ADMIN_UID = "dddddddd-4444-4444-8444-dddddddddddd";
const ORDER_NOURA_PAID = "a0000000-0000-4000-8000-000000000001";
const ORDER_SALEM_UNPAID = "a0000000-0000-4000-8000-000000000002";
const ORDER_NOURA_DELIVERED = "a0000000-0000-4000-8000-000000000003";
const VARIANT_SKU = "stg-amber-oud-100ml";

let failures = 0;
const check = (name, cond) => {
  console.log((cond ? "  ✅ " : "  ❌ ") + name);
  if (!cond) failures++;
};

const client = new pg.Client({ connectionString: CONNECTION });

/**
 * Run `fn` inside a transaction as `role`, with `sub` as the JWT subject, then
 * roll back. Every case therefore starts from the seeded state.
 */
async function as(role, sub, fn) {
  await client.query("begin");
  try {
    await client.query("select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify(sub ? { sub, role } : { role })]);
    await client.query(`set local role ${role}`);
    return await fn();
  } finally {
    await client.query("rollback");
  }
}

/**
 * Run a query that is expected to be refused. A refusal often arrives as an
 * error, and an error poisons the surrounding transaction, so each attempt is
 * fenced by a savepoint and the transaction survives to run the next case.
 * Returns { threw, rowCount }.
 */
let probeSeq = 0;
async function probe(text, params = []) {
  const sp = `probe_${++probeSeq}`;
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

/** Refused: either an error, or zero rows touched. */
async function denied(text, params = []) {
  const r = await probe(text, params);
  return r.threw || r.rowCount === 0;
}

/** Refused outright (missing grant / failed WITH CHECK). */
async function raises(text, params = []) {
  return (await probe(text, params)).threw;
}

async function rows(text, params = []) {
  const r = await client.query(text, params);
  return r.rows;
}

async function main() {
  await client.connect();

  // --- setup ---------------------------------------------------------------
  await client.query("drop schema if exists public cascade; create schema public;");
  await client.query("drop schema if exists auth cascade;");
  await client.query(sql("supabase/test/shim.sql"));
  await client.query(sql("supabase/migrations/0001_baseline.sql"));
  await client.query(sql("supabase/migrations/0002_rls.sql"));
  await client.query(sql("supabase/migrations/0003_audit.sql"));
  await client.query(sql("supabase/migrations/0004_harden_audit.sql"));
  await client.query(sql("supabase/migrations/0005_anon_ownership.sql"));
  await client.query(sql("supabase/migrations/0006_restrictive_writes.sql"));
  await client.query(sql("supabase/migrations/0007_place_order.sql"));
  await client.query(sql("supabase/migrations/0008_anon_cleanup.sql"));
  await client.query(sql("supabase/seed/staging_seed.sql"));

  // مَنفذ للطفرة: يسمح لـrls-mutation-proof.mjs بإضعاف سياسة واحدة بعد تطبيق
  // الهجرات، ليثبت أن هذه المجموعة تحمرّ فعلاً حين تنكسر الحماية. اختبار لا
  // يفشل عند إضعاف ما يحرسه لا يثبت شيئاً.
  if (process.env.RLS_WEAKEN_SQL) {
    console.log("\n⚠️  وضع الطفرة: " + process.env.RLS_WEAKEN_SQL);
    await client.query(process.env.RLS_WEAKEN_SQL);
  }

  console.log("\n— الأساس: الجداول وتفعيل RLS —");
  const tables = (await rows(
    `select tablename, rowsecurity from pg_tables
      where schemaname = 'public' order by tablename`));
  check(`١٦ جدولاً أُنشئت (${tables.length})`, tables.length === 16);
  check("RLS مفعّل على كل الجداول بلا استثناء", tables.every((t) => t.rowsecurity === true));
  const policyCount = Number((await rows(
    "select count(*)::int as n from pg_policies where schemaname = 'public'"))[0].n);
  check(`سياسات مكتوبة (${policyCount})`, policyCount > 0);
  const noPolicy = (await rows(
    `select t.tablename from pg_tables t
      where t.schemaname = 'public'
        and not exists (select 1 from pg_policies p
                        where p.schemaname = 'public' and p.tablename = t.tablename)`));
  check("لا جدول بلا سياسة واحدة على الأقل", noPolicy.length === 0);

  // --- 1 -------------------------------------------------------------------
  console.log("\n— ١) عميل لا يرى طلبات عميل آخر —");
  await as("authenticated", NOURA_UID, async () => {
    const own = await rows("select order_number from public.orders order by order_number");
    check("نورة ترى طلباتها هي فقط (STG-1001, STG-1003)",
      own.length === 2 && own.every((o) => o.order_number !== "STG-1002"));
    const other = await rows("select 1 from public.orders where id = $1", [ORDER_SALEM_UNPAID]);
    check("نورة لا ترى طلب سالم STG-1002", other.length === 0);
    const otherItems = await rows(
      "select 1 from public.order_items where order_id = $1", [ORDER_SALEM_UNPAID]);
    check("ولا ترى بنود طلبه", otherItems.length === 0);
    const otherCustomer = await rows(
      "select 1 from public.customers where user_id = $1", [SALEM_UID]);
    check("ولا ترى ملفه الشخصي", otherCustomer.length === 0);
  });

  // --- 2 -------------------------------------------------------------------
  console.log("\n— ٢) الزائر المجهول: يقرأ الرف ولا شيء غيره —");
  await as("anon", null, async () => {
    const products = await rows("select 1 from public.products");
    check("يقرأ المنتجات", products.length === 20);
    check("يقرأ المتغيّرات", (await rows("select 1 from public.product_variants")).length === 60);
    check("يقرأ كتالوج العطور", (await rows("select 1 from public.perfume_catalog")).length === 8);
    check("لا يقرأ العملاء", await raises("select * from public.customers"));
    check("لا يقرأ الطلبات", await raises("select * from public.orders"));
    check("لا يقرأ المدفوعات", await raises("select * from public.payments"));
    check("لا يقرأ السلال", await raises("select * from public.carts"));
    check("لا يقرأ سجل التدقيق", await raises("select * from public.audit_logs"));
  });

  // الفحوص أعلاه تُرفض على طبقة الصلاحيات (لا GRANT للزائر أصلاً)، وهذه حماية
  // حقيقية لكنها ليست RLS. والفرق مهم: Supabase يمنح anon صلاحيات على جداول
  // public افتراضياً، فلو أعاد أحد منحها لاحقاً لبقيت RLS وحدها الحاجز. لذلك
  // نمنح الصلاحية مؤقتاً ونشترط أن تُرجع RLS صفر صفوف — أي أن الطبقة الثانية
  // تحمي وحدها.
  console.log("\n— ٢-ب) حتى لو مُنح الزائر الصلاحية، RLS وحدها تحجب —");
  const GRANTED = ["customers", "orders", "payments", "carts", "audit_logs"];
  await client.query("begin");
  try {
    for (const t of GRANTED) await client.query(`grant select on public.${t} to anon`);
    await client.query("select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ role: "anon" })]);
    await client.query("set local role anon");
    for (const t of GRANTED) {
      const r = await probe(`select * from public.${t}`);
      check(`${t}: صفر صف رغم وجود الصلاحية`, !r.threw && r.rowCount === 0);
    }
  } finally {
    await client.query("rollback");
  }

  // --- 3 -------------------------------------------------------------------
  console.log("\n— ٣) العميل لا يغيّر حالة الدفع —");
  await as("authenticated", SALEM_UID, async () => {
    check("لا يعلّم طلبه كمدفوع",
      await denied("update public.orders set payment_status = 'paid', status = 'paid' where id = $1",
        [ORDER_SALEM_UNPAID]));
    check("لا يعدّل صف الدفع نفسه",
      await denied("update public.payments set status = 'paid' where order_id = $1",
        [ORDER_SALEM_UNPAID]));
    check("ولا يُدرج دفعة جديدة",
      await denied(
        `insert into public.payments (order_id, provider, status, amount_fils)
         values ($1, 'mock', 'paid', 1)`, [ORDER_SALEM_UNPAID]));
    await client.query("reset role");
    const after = await rows(
      "select payment_status, status from public.orders where id = $1", [ORDER_SALEM_UNPAID]);
    check("الطلب ما زال unpaid/pending فعلياً",
      after[0].payment_status === "unpaid" && after[0].status === "pending");
  });

  // --- 4 -------------------------------------------------------------------
  console.log("\n— ٤) العميل لا يكتب حركات المخزون —");
  await as("authenticated", NOURA_UID, async () => {
    const variantId = (await rows(
      "select id from public.product_variants where sku = $1", [VARIANT_SKU]))[0].id;
    check("لا يُدرج حركة مخزون",
      await raises(
        `insert into public.inventory_movements (variant_id, delta_qty, reason)
         values ($1, 999, 'adjustment')`, [variantId]));
    check("ولا يقرأ سجل المخزون",
      (await rows("select 1 from public.inventory_movements")).length === 0);
  });

  // --- 5 -------------------------------------------------------------------
  console.log("\n— ٥) العميل لا يغيّر طابور الإنتاج —");
  await as("authenticated", NOURA_UID, async () => {
    check("لا يعدّل حالة طابور إنتاج طلبه",
      await denied("update public.production_queue set status = 'done' where order_id = $1",
        [ORDER_NOURA_PAID]));
    check("ولا يقرأ الطابور أصلاً",
      (await rows("select 1 from public.production_queue")).length === 0);
    await client.query("reset role");
    const pq = await rows(
      "select status from public.production_queue where order_id = $1", [ORDER_NOURA_PAID]);
    check("الحالة ما زالت mixing", pq[0].status === "mixing");
  });

  // --- 6 -------------------------------------------------------------------
  console.log("\n— ٦) العميل لا يغيّر الشحنات —");
  await as("authenticated", NOURA_UID, async () => {
    check("يتابع شحنة طلبه (قراءة مسموحة)",
      (await rows("select 1 from public.shipments where order_id = $1",
        [ORDER_NOURA_DELIVERED])).length === 1);
    check("ولا يعدّل حالتها",
      await denied("update public.shipments set status = 'pending' where order_id = $1",
        [ORDER_NOURA_DELIVERED]));
    check("ولا يُدرج شحنة",
      await denied(
        `insert into public.shipments (order_id, carrier, status)
         values ($1, 'mock', 'in_transit')`, [ORDER_NOURA_DELIVERED]));
    await client.query("reset role");
    const s = await rows("select status from public.shipments where order_id = $1",
      [ORDER_NOURA_DELIVERED]);
    check("الشحنة ما زالت delivered", s[0].status === "delivered");
  });

  // --- 7 -------------------------------------------------------------------
  console.log("\n— ٧) أسطح الإدارة للمدير وحده —");
  const ADMIN_SURFACES = [
    ["admin_users", "المستخدمون الإداريون"],
    ["audit_logs", "سجل التدقيق"],
    ["inventory_movements", "حركات المخزون"],
    ["production_queue", "طابور الإنتاج"],
    ["staging_outbox", "صندوق الإرسال التجريبي"],
  ];
  await as("authenticated", NOURA_UID, async () => {
    for (const [table, label] of ADMIN_SURFACES) {
      check(`العميل لا يقرأ ${label}`,
        (await rows(`select 1 from public.${table}`)).length === 0);
    }
    check("العميل لا يرقّي نفسه إلى مدير",
      await raises(
        `insert into public.admin_users (user_id, email, role)
         values ($1, 'attacker@example.test', 'owner')`, [NOURA_UID]));
  });
  await as("authenticated", ADMIN_UID, async () => {
    check("المدير يقرأ المستخدمين الإداريين",
      (await rows("select 1 from public.admin_users")).length === 1);
    check("المدير يقرأ طابور الإنتاج",
      (await rows("select 1 from public.production_queue")).length === 1);
    check("المدير يقرأ صندوق الإرسال",
      (await rows("select 1 from public.staging_outbox")).length === 2);
    check("المدير يرى كل الطلبات (٣)",
      (await rows("select 1 from public.orders")).length === 3);
    check("المدير يرى كل العملاء (٣)",
      (await rows("select 1 from public.customers")).length === 3);
  });

  // --- 8 -------------------------------------------------------------------
  // كُتبت بعد أن نجح التزوير فعلاً على مشروع Supabase حقيقي: `audit_logs` بلا
  // سياسة إدراج، لكن الدالة التي تكتب فيه SECURITY DEFINER وكانت صلاحية
  // تنفيذها مفتوحة، وPostgREST يكشف كل دالة في public كنقطة RPC. فالباب لم يكن
  // الجدول بل الدالة.
  console.log("\n— ٧-ب) العميل لا يزوّر سجل تدقيق عبر استدعاء الدالة —");
  await as("authenticated", SALEM_UID, async () => {
    const before = Number((await rows("select count(*)::int as n from public.audit_logs"))[0]?.n ?? 0);
    const forged = await probe(
      `select public.write_audit_log('update', 'orders', null, '{}'::jsonb, '{"forged":true}'::jsonb)`
    );
    check("استدعاء write_audit_log مرفوض", forged.threw);
    const after = Number((await rows("select count(*)::int as n from public.audit_logs"))[0]?.n ?? 0);
    check("ولا صف جديد في السجل", after === before);
  });

  // ٨) تغيّر جوهري عن النسخة السابقة من هذا الاختبار: المدير لم يعد يكتب
  // `orders.status` بجملة UPDATE. صلاحية العمود مسحوبة عن `authenticated` في
  // 0006، والمدير على Supabase هو الدور `authenticated` نفسه — لا دور خاص به.
  // فنُقل عمله إلى `admin_set_order_status()`، وهي SECURITY DEFINER تتحقّق من
  // is_admin() قبل الكتابة. المحصّلة أضيق لا أوسع: الباب واحد ومُعلن، ومحروس
  // بالهوية لا بصلاحية دور تشمل كل موقّع. والـtriggers تعمل كما كانت.
  console.log("\n— ٨) تعديل المدير يُكتب في سجل التدقيق —");
  await as("authenticated", ADMIN_UID, async () => {
    const before = Number((await rows(
      "select count(*)::int as n from public.audit_logs"))[0].n);
    check("المدير لا يكتب حالة الطلب بجملة UPDATE مباشرة",
      await denied("update public.orders set status = 'ready' where id = $1",
        [ORDER_NOURA_PAID]));
    const upd = await client.query(
      "select public.admin_set_order_status($1, 'ready') as o", [ORDER_NOURA_PAID]);
    check("المدير ينقل الحالة عبر admin_set_order_status", upd.rowCount === 1);
    const logged = await rows(
      `select actor_id, action, entity, before, after from public.audit_logs
        where entity = 'orders' and entity_id = $1
        order by created_at desc limit 1`, [ORDER_NOURA_PAID]);
    check("صف جديد في audit_logs",
      Number((await rows("select count(*)::int as n from public.audit_logs"))[0].n) === before + 1);
    check("السجل يحمل الفاعل الصحيح", logged[0] && logged[0].actor_id === ADMIN_UID);
    check("السجل يحمل قبل/بعد الحالة",
      logged[0] && logged[0].before.status === "in_production" && logged[0].after.status === "ready");

    const variantId = (await rows(
      "select id from public.product_variants where sku = $1", [VARIANT_SKU]))[0].id;
    check("المدير لا يُدرج حركة مخزون بجملة INSERT مباشرة",
      await raises(
        `insert into public.inventory_movements (variant_id, delta_qty, reason)
         values ($1, -1, 'sale')`, [variantId]));
    await client.query(
      "select public.admin_record_inventory_movement($1, -1, 'sale')", [variantId]);
    check("حركة مخزون من المدير تُسجَّل أيضاً",
      (await rows("select 1 from public.audit_logs where entity = 'inventory_movements'")).length === 1);
  });

  console.log("\n— قيد إضافي: طابور الإنتاج للمدفوع فقط —");
  await as("service_role", null, async () => {
    check("إدراج طلب غير مدفوع في الطابور مرفوض",
      await raises(
        `insert into public.production_queue (order_id, status) values ($1, 'queued')`,
        [ORDER_SALEM_UNPAID]));
  });

  // =========================================================================
  // ٩ فما بعد — المتسوّق المجهول.
  //
  // كل ما سبق كُتب حين كان `authenticated` يعني «عميل سجّل بحساب». صار يعني
  // أيضاً «زائر ضغط زراً»: تسجيل الدخول المجهول على Supabase يمنح الدور نفسه،
  // ويفرّقه ادّعاء `is_anonymous: true` وحده. فالأقسام التالية تعيد طرح الأسئلة
  // القديمة على هذا الفاعل الجديد، بجلستين مجهولتين متمايزتين لا واحدة —
  // لأن «أ لا يرى شيئاً» قد يعني أن الحماية تعمل، وقد يعني أن لا شيء هناك.
  //
  // من هنا فصاعداً تُثبَّت المعاملات (commit) بدل التراجع: الجلسة أ يجب أن
  // تترك أثراً تراه الجلسة ب. وهي بعد كل الفحوص التي تعتمد على عدد صفوف
  // البذرة، فلا تُفسدها.
  // =========================================================================
  const ANON_A = "99999999-aaaa-4aaa-8aaa-999999999991";
  const ANON_B = "99999999-bbbb-4bbb-8bbb-999999999992";

  /** جلسة موقّعة تُثبَّت. `isAnon` يضع الادّعاء الذي يفرّق المجهول عن الدائم. */
  async function session(sub, isAnon, fn) {
    await client.query("begin");
    try {
      await client.query("select set_config('request.jwt.claims', $1, true)",
        [JSON.stringify({ sub, role: "authenticated", is_anonymous: isAnon })]);
      await client.query("set local role authenticated");
      const out = await fn();
      await client.query("commit");
      return out;
    } catch (e) {
      await client.query("rollback");
      throw e;
    }
  }

  /** استدعاء place_order كما يستدعيه المتصفّح. يعيد الكائن أو يرفع الخطأ. */
  const callPlaceOrder = async (items, customer, key, outcome = "success") =>
    (await client.query(
      "select public.place_order($1::jsonb, $2::jsonb, $3, $4) as r",
      [JSON.stringify(items), JSON.stringify(customer), key, outcome]))
      .rows[0].r;

  // حسابان مجهولان في auth.users (الشيم يوفّر الجدول بأعمدته الثلاثة).
  await client.query(
    `insert into auth.users (id, is_anonymous, created_at) values
       ($1, true, now() - interval '2 days'),
       ($2, true, now() - interval '2 days')
     on conflict (id) do nothing`, [ANON_A, ANON_B]);

  // متغيّر بسعر صفر — «غير قابل للشراء» يحتاج مثالاً حقيقياً، والبذرة كلها
  // بأسعار موجبة. القيد يسمح بـ0 (>= 0)، والسياسة هي التي ترفضه.
  const ZERO_VARIANT = (await rows(
    `with p as (
       insert into public.products (handle, title_ar, base_price_fils, is_available)
       values ('stg-zero-price', '[STG] بلا سعر', 0, true)
       on conflict (handle) do update set base_price_fils = 0
       returning id)
     insert into public.product_variants (product_id, sku, bottle_size, price_fils, stock_qty)
     select p.id, 'stg-zero-price-100ml', '100ml', 0, 5 from p
     on conflict (sku) do update set price_fils = 0
     returning id`))[0].id;

  const READY_100 = (await rows(
    "select id, price_fils from public.product_variants where sku = 'stg-amber-oud-100ml'"))[0];
  const READY_50 = (await rows(
    "select id, price_fils from public.product_variants where sku = 'stg-citrus-dawn-50ml'"))[0];

  console.log("\n— ٩) جلستان مجهولتان: كلٌّ يرى صفوفه وحده —");

  const orderA = await session(ANON_A, true, () => callPlaceOrder(
    [{ kind: "ready", variant_id: READY_100.id, quantity: 1 }],
    { full_name: "مجهول أ", phone: "0500009001", emirate: "دبي" },
    "key-anon-a-1"));
  const orderB = await session(ANON_B, true, () => callPlaceOrder(
    [{ kind: "ready", variant_id: READY_50.id, quantity: 1 }],
    { full_name: "مجهول ب", phone: "0500009002", emirate: "الشارقة" },
    "key-anon-b-1"));

  check("المجهول أ أنشأ طلباً", !!orderA.order_id);
  check("المجهول ب أنشأ طلباً", !!orderB.order_id);
  check("والطلبان مختلفان", orderA.order_id !== orderB.order_id);

  // سلة لكل جلسة، لإثبات أن السلة صارت كائناً من الدرجة الأولى بمحور auth.uid()
  const cartA = await session(ANON_A, true, async () => {
    const c = (await rows(
      `insert into public.carts (user_id, status) values (auth.uid(), 'open') returning id`))[0].id;
    await client.query(
      `insert into public.cart_items (cart_id, variant_id, quantity, unit_price_fils)
       values ($1, $2, 1, $3)`, [c, READY_100.id, READY_100.price_fils]);
    return c;
  });
  const cartB = await session(ANON_B, true, async () => {
    const c = (await rows(
      `insert into public.carts (user_id, status) values (auth.uid(), 'open') returning id`))[0].id;
    await client.query(
      `insert into public.cart_items (cart_id, variant_id, quantity, unit_price_fils)
       values ($1, $2, 2, $3)`, [c, READY_50.id, READY_50.price_fils]);
    return c;
  });
  check("المجهول أ يملك سلة في القاعدة", !!cartA);
  check("المجهول ب يملك سلة في القاعدة", !!cartB);

  /** الجانب المتماثل من فحص العزل: `me` لا يرى شيئاً من صفوف `them`. */
  async function isolation(label, me, them, theirOrder, theirCart) {
    await session(me, true, async () => {
      check(`${label}: لا يرى طلب الآخر`,
        (await rows("select 1 from public.orders where id = $1", [theirOrder.order_id])).length === 0);
      check(`${label}: يرى طلبه هو`,
        (await rows("select 1 from public.orders")).length === 1);
      check(`${label}: لا يرى بنود طلب الآخر`,
        (await rows("select 1 from public.order_items where order_id = $1",
          [theirOrder.order_id])).length === 0);
      check(`${label}: لا يرى سلة الآخر`,
        (await rows("select 1 from public.carts where id = $1", [theirCart])).length === 0);
      check(`${label}: لا يرى بنود سلة الآخر`,
        (await rows("select 1 from public.cart_items where cart_id = $1", [theirCart])).length === 0);
      check(`${label}: لا يرى ملف الآخر الشخصي`,
        (await rows("select 1 from public.customers where user_id = $1", [them])).length === 0);
      check(`${label}: يرى ملفه هو وحده`,
        (await rows("select 1 from public.customers")).length === 1);
      check(`${label}: لا يرى طلبات العطر المخصّص للآخر`,
        (await rows(
          `select 1 from public.custom_perfume_requests r
            join public.customers c on c.id = r.customer_id
           where c.user_id = $1`, [them])).length === 0);
      check(`${label}: لا يرى دفعة الآخر`,
        (await rows("select 1 from public.payments where order_id = $1",
          [theirOrder.order_id])).length === 0);
      // الكتابة في سلة الآخر مرفوضة، لا مقروءة-صفراً فحسب.
      check(`${label}: لا يكتب في سلة الآخر`,
        await denied("update public.carts set status = 'abandoned' where id = $1", [theirCart]));
      check(`${label}: لا يُدرج بنداً في سلة الآخر`,
        await denied(
          `insert into public.cart_items (cart_id, variant_id, quantity, unit_price_fils)
           values ($1, $2, 1, 1)`, [theirCart, READY_100.id]));
    });
  }
  await isolation("أ ← ب", ANON_A, ANON_B, orderB, cartB);
  await isolation("ب ← أ", ANON_B, ANON_A, orderA, cartA);

  // وأن السلة لم تتغيّر فعلاً — لا أن الجملة أخطأت فحسب.
  const cartBStatus = (await rows("select status from public.carts where id = $1", [cartB]))[0];
  check("سلة ب ما زالت open بعد محاولات أ", cartBStatus.status === "open");

  console.log("\n— ١٠) المجهول لا يمسّ المال ولا العمليات (والقيمة تُقرأ بعدها) —");
  await session(ANON_A, true, async () => {
    check("لا يعلّم طلبه كمدفوع",
      await denied("update public.orders set payment_status = 'paid' where id = $1",
        [orderA.order_id]));
    check("لا ينقل حالة طلبه",
      await denied("update public.orders set status = 'delivered' where id = $1",
        [orderA.order_id]));
    check("لا يعدّل دفعته",
      await denied("update public.payments set status = 'refunded' where order_id = $1",
        [orderA.order_id]));
    check("لا يُدرج دفعة",
      await denied(
        `insert into public.payments (order_id, provider, status, amount_fils)
         values ($1, 'mock', 'paid', 1)`, [orderA.order_id]));
    check("لا يكتب حركة مخزون",
      await denied(
        `insert into public.inventory_movements (variant_id, delta_qty, reason)
         values ($1, 5, 'adjustment')`, [READY_100.id]));
    check("لا يعدّل طابور الإنتاج",
      await denied("update public.production_queue set status = 'done' where order_id = $1",
        [orderA.order_id]));
    check("لا يُدرج شحنة",
      await denied(
        `insert into public.shipments (order_id, carrier, status) values ($1, 'mock', 'delivered')`,
        [orderA.order_id]));
    check("لا يكتب في سجل التدقيق",
      await denied(
        `insert into public.audit_logs (action, entity) values ('update', 'orders')`));
    check("ولا يستدعي دالة كتابة السجل",
      await raises(
        `select public.write_audit_log('update','orders',null,'{}'::jsonb,'{}'::jsonb)`));
    check("ولا يرقّي نفسه مديراً",
      await denied(
        `insert into public.admin_users (user_id, email, role)
         values (auth.uid(), 'anon-attacker@example.test', 'owner')`));
  });

  // القيم بعد المحاولات، مقروءةً بالمالك — لا يكفي أن الجملة أخطأت.
  const afterA = (await rows(
    `select o.status, o.payment_status, o.total_fils,
            (select p.status from public.payments p where p.order_id = o.id) as pay_status,
            (select q.status from public.production_queue q where q.order_id = o.id) as pq_status
       from public.orders o where o.id = $1`, [orderA.order_id]))[0];
  check("طلب أ ما زال paid/paid فعلياً",
    afterA.status === "paid" && afterA.payment_status === "paid");
  check("ودفعته ما زالت paid فعلياً", afterA.pay_status === "paid");
  check("وطابور إنتاجه ما زال queued فعلياً", afterA.pq_status === "queued");
  check("ولا شحنة اختُرعت له",
    (await rows("select 1 from public.shipments where order_id = $1",
      [orderA.order_id])).length === 0);
  check("ولا صف admin_users جديد",
    (await rows("select 1 from public.admin_users")).length === 1);

  console.log("\n— ١١) صلاحية الأعمدة مسحوبة فعلاً (لا سياسةً فحسب) —");
  const colPriv = await rows(
    `select column_name from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'orders'
        and grantee = 'authenticated' and privilege_type = 'UPDATE'
        and column_name in ('status','payment_status')`);
  check("authenticated لا يملك UPDATE على orders.status/payment_status",
    colPriv.length === 0);
  const tablePriv = await rows(
    `select table_name, privilege_type from information_schema.table_privileges
      where table_schema = 'public' and grantee = 'authenticated'
        and privilege_type in ('INSERT','UPDATE','DELETE')
        and table_name in ('payments','inventory_movements','production_queue',
                           'shipments','audit_logs','staging_outbox')`);
  check("ولا صلاحية كتابة على جداول المال والعمليات الستة",
    tablePriv.length === 0);

  console.log("\n— ١٢) السياسات المقيِّدة موجودة (وإسقاط أيّها يكسر المجموعة) —");
  const restrictive = await rows(
    `select tablename, policyname from pg_policies
      where schemaname = 'public' and permissive = 'RESTRICTIVE'`);
  const REQUIRED_RESTRICTIVE = [
    ["orders", "orders_no_client_update"],
    ["orders", "orders_no_client_insert"],
    ["orders", "orders_no_client_delete"],
    ["payments", "payments_no_client_insert"],
    ["payments", "payments_no_client_update"],
    ["inventory_movements", "inventory_movements_no_client_insert"],
    ["production_queue", "production_queue_no_client_update"],
    ["shipments", "shipments_no_client_insert"],
    ["audit_logs", "audit_logs_no_client_insert"],
    ["customers", "customers_restrict_to_owner"],
    ["carts", "carts_restrict_to_owner"],
    ["cart_items", "cart_items_restrict_to_owner"],
  ];
  for (const [t, p] of REQUIRED_RESTRICTIVE) {
    check(`سياسة مقيِّدة ${t}.${p}`,
      restrictive.some((r) => r.tablename === t && r.policyname === p));
  }

  console.log("\n— ١٣) place_order يُسعّر من القاعدة ويتجاهل ما يرسله المتصفّح —");
  const lied = await session(ANON_A, true, () => callPlaceOrder(
    [{
      kind: "ready", variant_id: READY_100.id, quantity: 1,
      // ما يلي كلّه كذب من «المتصفّح». يجب ألّا يترك أثراً.
      unit_price_fils: 1, price_fils: 1, line_total_fils: 1,
      total_fils: 1, subtotal_fils: 1, discount_fils: 999999,
    }],
    { full_name: "مجهول أ", phone: "0500009001" },
    "key-anon-a-lied"));
  const lieRow = (await rows(
    `select o.subtotal_fils, o.total_fils, o.discount_fils, o.shipping_fils,
            i.unit_price_fils, i.line_total_fils
       from public.orders o join public.order_items i on i.order_id = o.id
      where o.id = $1`, [lied.order_id]))[0];
  check(`سعر الوحدة من القاعدة (${lieRow.unit_price_fils} = ${READY_100.price_fils})`,
    lieRow.unit_price_fils === READY_100.price_fils);
  check("لا 1 فلس كما أرسل العميل", lieRow.unit_price_fils !== 1);
  check("المجموع الفرعي محسوب لا مستلَم", lieRow.subtotal_fils === READY_100.price_fils);
  check("الخصم المُرسل (999999) تُجوهل", lieRow.discount_fils === 0);
  check("الشحن 2500 لبند واحد", lieRow.shipping_fils === 2500);
  check("المجموع = فرعي + شحن",
    lieRow.total_fils === READY_100.price_fils + 2500);
  check("والقيمة المُعادة من الدالة تطابق المخزَّن", lied.total_fils === lieRow.total_fils);

  console.log("\n— ١٤) حدّ الثلاثة، محسوباً في الخادم —");
  const two = await session(ANON_A, true, () => callPlaceOrder(
    [{ kind: "ready", variant_id: READY_100.id, quantity: 2 }],
    {}, "key-anon-a-two"));
  const twoExpected = READY_100.price_fils * 2;
  check(`بندان: مجموع فرعي ${two.subtotal_fils}`, two.subtotal_fils === twoExpected);
  check("بندان: شحن 2500", two.shipping_fils === 2500);
  check("بندان: لا خصم", two.discount_fils === 0);
  check("بندان: المجموع = فرعي + 2500", two.total_fils === twoExpected + 2500);

  const three = await session(ANON_A, true, () => callPlaceOrder(
    [{ kind: "ready", variant_id: READY_100.id, quantity: 3 }],
    {}, "key-anon-a-three"));
  const threeExpected = READY_100.price_fils * 3;
  // تقريب النصف لأعلى، بالحساب الصحيح نفسه المعرَّف في pricing.ts
  const expectedDiscount = Math.floor((threeExpected * 5 * 2 + 100) / 200);
  check(`ثلاثة: مجموع فرعي ${three.subtotal_fils}`, three.subtotal_fils === threeExpected);
  check("ثلاثة: شحن 0", three.shipping_fils === 0);
  check(`ثلاثة: خصم 5% = ${expectedDiscount}`, three.discount_fils === expectedDiscount);
  check("ثلاثة: المجموع = فرعي − خصم",
    three.total_fils === threeExpected - expectedDiscount);

  // والحدّ يُحسب من مجموع الكميات لا عدد البنود: ثلاثة بنود بكمية ١ = نفس الحكم.
  const threeLines = await session(ANON_B, true, () => callPlaceOrder(
    [{ kind: "ready", variant_id: READY_100.id, quantity: 1 },
     { kind: "ready", variant_id: READY_50.id, quantity: 1 },
     { kind: "custom", catalog_code: "STG-001", size: "100ml", quantity: 1 }],
    {}, "key-anon-b-three-lines"));
  const linesSubtotal = READY_100.price_fils + READY_50.price_fils + 32000;
  check(`ثلاثة بنود منفصلة: فرعي ${threeLines.subtotal_fils}`,
    threeLines.subtotal_fils === linesSubtotal);
  check("ثلاثة بنود منفصلة: شحن 0", threeLines.shipping_fils === 0);
  check("ثلاثة بنود منفصلة: خصم مطبَّق", threeLines.discount_fils > 0);
  check("والعطر المخصّص 100ml سُعّر 32000",
    (await rows(
      `select unit_price_fils from public.order_items
        where order_id = $1 and custom_request_id is not null`,
      [threeLines.order_id]))[0].unit_price_fils === 32000);

  console.log("\n— ١٥) غير القابل للشراء يُرفض —");
  await session(ANON_A, true, async () => {
    check("متغيّر بسعر صفر مرفوض",
      await raises("select public.place_order($1::jsonb, '{}'::jsonb, $2, 'success')",
        [JSON.stringify([{ kind: "ready", variant_id: ZERO_VARIANT, quantity: 1 }]),
         "key-anon-a-zero"]));
    check("مقاس مخصّص غير معتمد (200ml) مرفوض",
      await raises("select public.place_order($1::jsonb, '{}'::jsonb, $2, 'success')",
        [JSON.stringify([{ kind: "custom", catalog_code: "STG-001", size: "200ml", quantity: 1 }]),
         "key-anon-a-200"]));
    check("كمية صفر مرفوضة",
      await raises("select public.place_order($1::jsonb, '{}'::jsonb, $2, 'success')",
        [JSON.stringify([{ kind: "ready", variant_id: READY_100.id, quantity: 0 }]),
         "key-anon-a-qty0"]));
    check("قائمة فارغة مرفوضة",
      await raises("select public.place_order('[]'::jsonb, '{}'::jsonb, $1, 'success')",
        ["key-anon-a-empty"]));
  });
  check("ولم يُنشَأ أي طلب من المحاولات المرفوضة",
    (await rows(
      `select 1 from public.orders where idempotency_key in
        ('key-anon-a-zero','key-anon-a-200','key-anon-a-qty0','key-anon-a-empty')`)).length === 0);

  console.log("\n— ١٦) المفتاح نفسه مرّتين ⇒ طلب واحد —");
  const KEY = "key-idem-once";
  const first = await session(ANON_B, true, () => callPlaceOrder(
    [{ kind: "ready", variant_id: READY_100.id, quantity: 1 }], {}, KEY));
  const second = await session(ANON_B, true, () => callPlaceOrder(
    // بنود مختلفة عمداً: المفتاح هو ما يحسم، لا محتوى الطلب. لو أنشأت الدالة
    // طلباً ثانياً بمحتوى مختلف لكان ذلك أسوأ من التكرار البسيط.
    [{ kind: "ready", variant_id: READY_50.id, quantity: 3 }], {}, KEY));
  check("الاستدعاء الثاني يُعيد المعرّف نفسه", first.order_id === second.order_id);
  check("ويُعيد الرقم نفسه", first.order_number === second.order_number);
  check("ويُعلن أنه إعادة", second.idempotent_replay === true);
  const idemCount = Number((await rows(
    `select count(*)::int as n from public.orders
      where idempotency_key = $1 and customer_id =
        (select id from public.customers where user_id = $2)`, [KEY, ANON_B]))[0].n);
  check(`صف واحد لا غير في orders (${idemCount})`, idemCount === 1);
  check("ولا بنود مضاعفة",
    Number((await rows(
      "select count(*)::int as n from public.order_items where order_id = $1",
      [first.order_id]))[0].n) === 1);
  check("ولا دفعة ثانية",
    Number((await rows(
      "select count(*)::int as n from public.payments where order_id = $1",
      [first.order_id]))[0].n) === 1);

  // الفحص أعلاه يمرّ باستعلام البحث المبكر داخل place_order، وهو يكفي للحالة
  // الشائعة (نقرة ثانية بعد أن نجحت الأولى). لكنه لا يكفي للحالة النادرة:
  // استدعاءان متزامنان يقرآن «لا طلب» قبل أن يكتب أيّهما. هناك لا يحسم إلا
  // الفهرس الفريد. ولأن سباقاً حقيقياً لا يُستدعى بموثوقية من اختبار، يُفحص
  // وجود الفهرس نفسه — وهو ما يجعل إسقاطه طفرةً مكشوفة لا تحسيناً صامتاً.
  const idemIndex = await rows(
    `select indexdef from pg_indexes
      where schemaname = 'public' and tablename = 'orders'
        and indexname = 'uq_orders_idempotency'`);
  check("فهرس فريد على (customer_id, idempotency_key) موجود", idemIndex.length === 1);
  check("وهو UNIQUE فعلاً وعلى العمودين",
    idemIndex.length === 1
    && /unique/i.test(idemIndex[0].indexdef)
    && /customer_id/.test(idemIndex[0].indexdef)
    && /idempotency_key/.test(idemIndex[0].indexdef));

  console.log("\n— ١٧) المدفوع وحده يدخل طابور الإنتاج —");
  const paidOrder = await session(ANON_A, true, () => callPlaceOrder(
    [{ kind: "ready", variant_id: READY_100.id, quantity: 1 }], {}, "key-outcome-paid", "success"));
  const failedOrder = await session(ANON_A, true, () => callPlaceOrder(
    [{ kind: "ready", variant_id: READY_100.id, quantity: 1 }], {}, "key-outcome-failed", "failed"));
  check("الطلب الناجح paid/paid",
    paidOrder.status === "paid" && paidOrder.payment_status === "paid");
  check("والفاشل failed/failed",
    failedOrder.status === "failed" && failedOrder.payment_status === "failed");
  check("المدفوع في الطابور",
    (await rows("select 1 from public.production_queue where order_id = $1",
      [paidOrder.order_id])).length === 1);
  check("والفاشل ليس فيه",
    (await rows("select 1 from public.production_queue where order_id = $1",
      [failedOrder.order_id])).length === 0);
  check("وللفاشل صف دفع بحالة failed",
    (await rows("select status from public.payments where order_id = $1",
      [failedOrder.order_id]))[0].status === "failed");
  check("ولا مزوّد حقيقي: كل الدفعات mock",
    (await rows("select 1 from public.payments where provider <> 'mock'")).length === 0);

  console.log("\n— ١٨) place_order: الصلاحية والهوية —");
  const grantees = await rows(
    `select r.rolname from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       cross join lateral (values ('anon'),('authenticated'),('service_role')) as g(name)
       join pg_roles r on r.rolname = g.name
      where n.nspname = 'public' and p.proname = 'place_order'
        and has_function_privilege(r.oid, p.oid, 'EXECUTE')`);
  const names = grantees.map((g) => g.rolname);
  check("authenticated يستطيع التنفيذ", names.includes("authenticated"));
  check("anon لا يستطيع", !names.includes("anon"));
  const sp = (await rows(
    `select proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'place_order'`))[0].proconfig;
  check("مسار البحث مثبّت",
    Array.isArray(sp) && sp.some((c) => c.startsWith("search_path=")));
  await as("anon", null, async () => {
    check("جلسة بلا هوية ترفَض عند الاستدعاء",
      await raises("select public.place_order('[]'::jsonb, '{}'::jsonb, 'k', 'success')"));
  });

  console.log("\n— ١٩) تنظيف الحسابات المجهولة الراكدة —");
  // حساب مجهول قديم بلا طلب، وآخر قديم بطلب. الأول يُحذف، والثاني لا.
  const STALE = "99999999-cccc-4ccc-8ccc-999999999993";
  await client.query(
    `insert into auth.users (id, is_anonymous, created_at)
     values ($1, true, now() - interval '90 days') on conflict do nothing`, [STALE]);
  await client.query(
    `update auth.users set created_at = now() - interval '90 days' where id = $1`, [ANON_A]);

  const dry = await rows("select deleted_user_id from public.cleanup_stale_anonymous_users()");
  const dryIds = dry.map((r) => r.deleted_user_id);
  check("الاستعراض يرشّح الحساب الراكد بلا طلب", dryIds.includes(STALE));
  check("ولا يرشّح حساباً له طلب (أ)", !dryIds.includes(ANON_A));
  check("والاستعراض لم يحذف شيئاً",
    (await rows("select 1 from auth.users where id = $1", [STALE])).length === 1);
  // probe() يحتاج معاملة (savepoint)، وهذا القسم يعمل خارجها لأن أثره يجب أن
  // يبقى. فتُفتح معاملة لهذا الفحص وحده ثم يُتراجع عنها.
  await client.query("begin");
  check("عتبة أقصر من يوم مرفوضة",
    await raises("select * from public.cleanup_stale_anonymous_users('30 minutes', false)"));
  await client.query("rollback");

  await client.query("select * from public.cleanup_stale_anonymous_users('30 days', false)");
  check("الحذف الفعلي أزال الراكد",
    (await rows("select 1 from auth.users where id = $1", [STALE])).length === 0);
  check("وأبقى صاحب الطلب (أ)",
    (await rows("select 1 from auth.users where id = $1", [ANON_A])).length === 1);
  check("وطلب أ ما زال قائماً بصاحبه",
    (await rows("select 1 from public.orders where id = $1", [orderA.order_id])).length === 1);

  await as("authenticated", NOURA_UID, async () => {
    check("العميل لا يستطيع استدعاء دالة التنظيف",
      await raises("select * from public.cleanup_stale_anonymous_users()"));
  });

  console.log(`\n${failures === 0 ? "✅ كل الاختبارات نجحت" : `❌ فشل ${failures}`}`);
  await client.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("\n❌ خطأ غير متوقع أثناء تنفيذ الاختبار:\n", err);
  try { await client.end(); } catch { /* already closed */ }
  process.exit(1);
});
