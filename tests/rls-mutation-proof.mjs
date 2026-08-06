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

  // ------------------------------------------------------------------------
  // طفرات جلسة الضيف (0009–0010).
  //
  // هوية الضيف كلّها تقوم على شيء واحد: أن `guest_session_id_for` ترفض ما
  // يجب أن تُرفض. فتُضعَف في ثلاثة اتجاهات منفصلة — الهاش، الإبطال،
  // الانقضاء — لا في طفرة واحدة تُطفئ الثلاثة، لأن طفرةً واحدة كانت ستمرّ
  // لو كان الاختبار يفحص واحداً منها فقط.
  // ------------------------------------------------------------------------
  {
    name: "التحقّق من الرمز ملغى: أي رمز يفتح أول جلسة",
    sql: `create or replace function public.guest_session_id_for(p_token text)
          returns uuid language sql stable security definer
          set search_path = public, pg_temp
          as $x$ select id from public.guest_sessions order by created_at limit 1 $x$;`,
  },
  {
    name: "فحص الإبطال محذوف: الرمز المُبطل ما زال يعمل",
    sql: `create or replace function public.guest_session_id_for(p_token text)
          returns uuid language plpgsql stable security definer
          set search_path = public, pg_temp
          as $x$
          declare v public.guest_sessions;
          begin
            select * into v from public.guest_sessions
             where token_hash = public.guest_token_hash(p_token);
            if not found then
              raise exception 'GUEST_TOKEN_UNKNOWN: لا جلسة' using errcode='42501';
            end if;
            if v.expires_at <= now() then
              raise exception 'GUEST_TOKEN_EXPIRED: انقضت' using errcode='42501';
            end if;
            return v.id;
          end $x$;`,
  },
  {
    name: "فحص الانقضاء محذوف: الرمز المنتهي ما زال يعمل",
    sql: `create or replace function public.guest_session_id_for(p_token text)
          returns uuid language plpgsql stable security definer
          set search_path = public, pg_temp
          as $x$
          declare v public.guest_sessions;
          begin
            select * into v from public.guest_sessions
             where token_hash = public.guest_token_hash(p_token);
            if not found then
              raise exception 'GUEST_TOKEN_UNKNOWN: لا جلسة' using errcode='42501';
            end if;
            if v.revoked_at is not null then
              raise exception 'GUEST_TOKEN_REVOKED: أُبطلت' using errcode='42501';
            end if;
            return v.id;
          end $x$;`,
  },
  {
    // الأخطاء الثلاثة تصير رسالةً واحدة. الحماية قائمة، لكن الواجهة تفقد
    // القدرة على التفرقة — وهي أحد ما يعد به 0010 صراحةً.
    name: "الأخطاء الثلاثة دُمجت في رسالة واحدة غامضة",
    sql: `create or replace function public.guest_session_id_for(p_token text)
          returns uuid language plpgsql stable security definer
          set search_path = public, pg_temp
          as $x$
          declare v public.guest_sessions;
          begin
            select * into v from public.guest_sessions
             where token_hash = public.guest_token_hash(p_token)
               and revoked_at is null and expires_at > now();
            if not found then
              raise exception 'GUEST_TOKEN_INVALID: رمز غير صالح' using errcode='42501';
            end if;
            return v.id;
          end $x$;`,
  },
  {
    name: "جدول جلسات الضيوف مكشوف للزائر",
    sql: `drop policy guest_sessions_no_client on public.guest_sessions;
          grant select on public.guest_sessions to anon;
          create policy tmp_gs_read on public.guest_sessions
            for select to anon, authenticated using (true);`,
  },
  {
    name: "صفوف الضيوف مكشوفة لكل جلسة موقّعة",
    sql: `drop policy orders_guest_rows_hidden  on public.orders;
          drop policy carts_guest_rows_hidden   on public.carts;
          drop policy customers_guest_rows_hidden on public.customers;
          drop policy cpr_guest_rows_hidden     on public.custom_perfume_requests;
          drop policy cart_items_guest_rows_hidden  on public.cart_items;
          drop policy order_items_guest_rows_hidden on public.order_items;
          drop policy orders_restrict_to_owner on public.orders;
          drop policy carts_restrict_to_owner  on public.carts;
          drop policy customers_restrict_to_owner on public.customers;
          drop policy orders_select_own on public.orders;
          create policy orders_select_own on public.orders
            for select to authenticated using (true);
          drop policy carts_select_own on public.carts;
          create policy carts_select_own on public.carts
            for select to authenticated using (true);
          drop policy customers_select_own on public.customers;
          create policy customers_select_own on public.customers
            for select to authenticated using (true);`,
  },
  {
    name: "قراءة حالة الطلب بلا حصر بالجلسة",
    sql: `create or replace function public.guest_order_status(
            p_token text, p_order_number text default null)
          returns jsonb language plpgsql security definer
          set search_path = public, pg_temp
          as $x$
          declare v uuid := public.guest_session_id_for(p_token); o jsonb;
          begin
            select coalesce(jsonb_agg(jsonb_build_object(
                     'order_id', x.id, 'order_number', x.order_number,
                     'status', x.status, 'items', '[]'::jsonb)), '[]'::jsonb)
              into o from public.orders x
             where p_order_number is null or x.order_number = p_order_number;
            return o;
          end $x$;`,
  },
  {
    name: "سقف محاولات الدفع مُعطَّل عملياً",
    sql: `create or replace function public.guest_checkout_cap() returns integer
            language sql immutable set search_path = public, pg_temp
            as $x$ select 1000000 $x$;`,
  },
  {
    name: "سقف إصدار الجلسات مُعطَّل عملياً",
    sql: `create or replace function public.guest_issue_cap() returns integer
            language sql immutable set search_path = public, pg_temp
            as $x$ select 1000000 $x$;`,
  },
  {
    name: "حارس تنظيف الضيوف يحذف جلسةً لها طلب",
    sql: `alter table public.orders drop constraint orders_guest_session_id_fkey;
          create or replace function public.cleanup_guest_sessions(
            p_older_than interval default '30 days',
            p_dry_run boolean default true,
            p_limit integer default 1000)
          returns table (deleted_session_id uuid, created_at timestamptz, last_seen_at timestamptz)
          language sql security definer set search_path = public, pg_temp
          as $x$
            select g.id, g.created_at, g.last_seen_at from public.guest_sessions g
             where g.last_seen_at < now() - p_older_than limit p_limit
          $x$;`,
  },
  {
    // الرمز الخام يُخزَّن بدل هاشه. القيد على شكل العمود يجب أن يمنع ذلك،
    // فإن لم يمنع فالاختبار الذي يفحص «لا عمود يساوي الرمز» هو خط الدفاع.
    name: "الرمز الخام يُخزَّن في القاعدة",
    sql: `alter table public.guest_sessions drop constraint guest_sessions_token_hash_check;
          create or replace function public.guest_token_hash(p_token text)
            returns text language sql immutable set search_path = public, pg_temp
            as $x$ select coalesce(p_token, '') $x$;`,
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
