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
  await client.query(sql("supabase/seed/staging_seed.sql"));

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
  console.log("\n— ٨) تعديل المدير يُكتب في سجل التدقيق —");
  await as("authenticated", ADMIN_UID, async () => {
    const before = Number((await rows(
      "select count(*)::int as n from public.audit_logs"))[0].n);
    const upd = await client.query(
      "update public.orders set status = 'ready' where id = $1", [ORDER_NOURA_PAID]);
    check("المدير يستطيع نقل حالة الطلب", upd.rowCount === 1);
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
    await client.query(
      `insert into public.inventory_movements (variant_id, delta_qty, reason)
       values ($1, -1, 'sale')`, [variantId]);
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

  console.log(`\n${failures === 0 ? "✅ كل الاختبارات نجحت" : `❌ فشل ${failures}`}`);
  await client.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("\n❌ خطأ غير متوقع أثناء تنفيذ الاختبار:\n", err);
  try { await client.end(); } catch { /* already closed */ }
  process.exit(1);
});
