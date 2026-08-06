/**
 * إثبات أن مجموعة RLS تقيس شيئاً.
 *
 * مجموعة اختبار خضراء لا تعني حماية سليمة — قد تعني أنها لا تفحص شيئاً. لذلك
 * نكسر الحماية عمداً ونشترط أن تحمرّ المجموعة، ثم نعيدها ونشترط أن تخضرّ.
 *
 * الطفرات مختارة لتصيب أخطر ثلاث ضمانات: عزل الطلبات بين العملاء، وحجب بيانات
 * العملاء عن الزائر، ومنع العميل من تعليم طلبه كمدفوع. لو مرّت أي منها خضراء،
 * فالسياسة المقابلة غير مُختبَرة فعلاً.
 */
import { spawnSync } from "node:child_process";

const MUTATIONS = [
  {
    // تُسقِط الطبقتين معاً بعد 0006. إسقاط السياسة المسموحة وحدها لم يعد
    // يكسر شيئاً — السياسة المقيِّدة تصمد — وطفرةٌ لا تُضعف الحماية لا تُثبت
    // شيئاً عن الاختبار. فوُسِّعت لتصف الكسر الحقيقي كاملاً.
    name: "عزل الطلبات: أي عميل يرى كل الطلبات",
    sql: `drop policy if exists orders_restrict_to_owner on public.orders;
          drop policy if exists orders_select_own on public.orders;
          create policy orders_select_own on public.orders for select to authenticated using (true);`,
  },
  {
    name: "بيانات العملاء مكشوفة للزائر",
    sql: `drop policy if exists customers_restrict_to_owner on public.customers;
          create policy tmp_customers_anon on public.customers for select to anon using (true);`,
  },
  {
    name: "العميل يعدّل المدفوعات",
    sql: `drop policy if exists payments_no_client_update on public.payments;
          grant update on public.payments to authenticated;
          create policy tmp_payments_write on public.payments for update to authenticated using (true) with check (true);`,
  },
  {
    // الطفرة التي تعيد الثغرة الحقيقية: إعادة منح تنفيذ دالة كتابة السجل.
    name: "سجل التدقيق قابل للتزوير من جديد",
    sql: `grant execute on function public.write_audit_log(text, text, uuid, jsonb, jsonb) to authenticated;`,
  },

  // ------------------------------------------------------------------------
  // طفرات المتسوّق المجهول والمسار الذرّي (0005–0008).
  //
  // الطبقتان في 0006 تفشلان بطريقتين مختلفتين، والطفرة الواحدة لا تكشف إلا
  // واحدة منهما. لذلك تُطفأ كلٌّ على حدة: إعادة منح صلاحية العمود تكشف أن
  // الاختبار يقرأ information_schema لا نصّ الهجرة، وإسقاط السياسة المقيِّدة
  // يكشف أنه يقرأ pg_policies. ثم طفرة ثالثة تُطفئ الطبقتين معاً لتُثبت أن
  // النتيجة سلوكية أيضاً: المجهول يعلّم طلبه كمدفوع فعلاً.
  // ------------------------------------------------------------------------
  {
    name: "إعادة منح UPDATE على orders.payment_status",
    sql: `grant update (payment_status) on public.orders to authenticated;`,
  },
  {
    name: "إسقاط سياسة مقيِّدة (orders_no_client_update)",
    sql: `drop policy orders_no_client_update on public.orders;`,
  },
  {
    name: "إسقاط الطبقتين معاً: المجهول يعلّم طلبه كمدفوع",
    sql: `drop policy orders_no_client_update on public.orders;
          drop policy orders_restrict_to_owner on public.orders;
          grant update (payment_status, status) on public.orders to authenticated;
          create policy tmp_orders_update on public.orders
            for update to authenticated using (true) with check (true);`,
  },
  {
    name: "عزل السلال بين جلستين مجهولتين مكسور",
    sql: `drop policy cart_items_restrict_to_owner on public.cart_items;
          drop policy carts_restrict_to_owner on public.carts;
          drop policy carts_select_own on public.carts;
          create policy carts_select_own on public.carts
            for select to authenticated using (true);`,
  },
  {
    name: "عدم التكرار معطَّل: إسقاط الفهرس الفريد للمفتاح",
    sql: `drop index public.uq_orders_idempotency;`,
  },
  {
    // التسعير في الخادم ليس تعليقاً في ملف هجرة، إنما رقم يُقاس. تحريك الحدّ
    // من ٣ إلى ٢ يجعل حالة «بندان» تنال خصماً، وهو ما يجب أن تمسكه المجموعة.
    name: "حدّ الكمية حُرّك من ٣ إلى ٢",
    sql: `create or replace function public.bulk_threshold_items() returns integer
            language sql immutable as $x$ select 2 $x$;`,
  },
  {
    name: "الشحن الثابت صار صفراً",
    sql: `create or replace function public.shipping_flat_fils() returns integer
            language sql immutable as $x$ select 0 $x$;`,
  },
  {
    name: "حارس التنظيف يحذف حساباً له طلب",
    sql: `create or replace function public.cleanup_stale_anonymous_users(
            p_older_than interval default '30 days',
            p_dry_run boolean default true,
            p_limit integer default 1000)
          returns table (deleted_user_id uuid, created_at timestamptz)
          language sql security definer set search_path = public, auth, pg_temp
          as $x$
            select u.id, u.created_at from auth.users u
             where coalesce(u.is_anonymous, false) and u.created_at < now() - p_older_than
             limit p_limit
          $x$;`,
  },
];

const run = (env) =>
  spawnSync(process.execPath, ["tests/rls.test.mjs"], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });

let failures = 0;
const check = (name, cond) => {
  console.log((cond ? "  ✅ " : "  ❌ ") + name);
  if (!cond) failures++;
};

console.log("\n١) الحماية سليمة:");
const clean = run({});
console.log(`   خروج = ${clean.status} ${clean.status === 0 ? "(أخضر ✅)" : "(أحمر ❌)"}`);
check("المجموعة تنجح على السياسات الحقيقية", clean.status === 0);

console.log("\n٢) الحماية مكسورة عمداً — يجب أن تحمرّ:");
for (const m of MUTATIONS) {
  const mutated = run({ RLS_WEAKEN_SQL: m.sql });
  check(`${m.name} → خروج ${mutated.status}`, mutated.status !== 0);
}

console.log("\n٣) بلا طفرة من جديد:");
const restored = run({});
check("المجموعة تعود خضراء", restored.status === 0);

console.log(
  failures === 0
    ? "\n✅ مُثبَت: المجموعة تنجح مع الحماية وتفشل بدونها — فهي تقيس السياسات لا نصّها."
    : `\n❌ ${failures} مخالفة — طفرة لم تُكتشف تعني سياسة غير مُختبَرة.`
);
process.exit(failures === 0 ? 0 : 1);
