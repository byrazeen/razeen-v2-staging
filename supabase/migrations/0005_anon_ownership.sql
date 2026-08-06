-- ============================================================================
-- RAZEEN V2 STAGING — 0005_anon_ownership.sql
--
-- ملكية الصفوف مربوطة بـauth.uid()، بعد أن صار المتسوّق المجهول واقعاً.
-- Ownership re-keyed to auth.uid(), now that the anonymous shopper is real.
--
-- ما الذي تغيّر في العالم؟ Supabase يمنح المستخدم المجهول (anonymous sign-in)
-- الدور `authenticated` نفسه، ويفرّقه بادّعاء `is_anonymous: true` في الـJWT
-- وحده. فكل سطر في 0002 قرأ `to authenticated` على أنه «عميل حقيقي» صار يقرأ
-- الآن على أنه «أي زائر ضغط زراً». وهذا ليس خللاً في 0002 بقدر ما هو تغيّر في
-- معنى الدور نفسه.
--
-- ثلاث مشاكل ملموسة يعالجها هذا الملف:
--
--   ١) السلة كانت تعيش في localStorage، وهي الآن تنتقل إلى قاعدة البيانات.
--      لكن `carts.customer_id` يشترط وجود صف `customers` — والمجهول لا يملك
--      واحداً قبل أول طلب. النتيجة: `customer_id = current_customer_id()`
--      تُقارن NULL بـNULL فتُرجع NULL لا TRUE، فالسلة لا تُقرأ ولا تُكتب.
--      الحل: عمود `user_id` على `carts` مربوط مباشرة بـauth.uid()، فتصبح
--      السلة كائناً من الدرجة الأولى لا تابعاً لصف عميل قد لا يوجد.
--
--   ٢) `current_customer_id()` تُرجع NULL لمن لا صف له، و`x = NULL` ليست
--      خطأً بل NULL — وهذا آمن في USING (يُعامَل كرفض) لكنه هشّ: أي سياسة
--      تُكتب لاحقاً بصيغة `or` قد تبتلع NULL. لذلك تُغلَّف المقارنات هنا
--      بدوال ملكية صريحة تُرجع boolean غير قابل للـNULL.
--
--   ٣) لا سبيل للمستخدم أن يُنشئ صف `customers` الخاص به دون أن يستطيع
--      انتحال غيره. السياسة القديمة سمحت بالإدراج بشرط `user_id = auth.uid()`،
--      وهذا صحيح لكنه ناقص: لم يكن هناك ما يمنع UPDATE من نقل `user_id` إلى
--      مستخدم آخر. تُشدَّد هنا بحيث تُفحص الملكية قبل التعديل وبعده.
--
-- ملاحظة مقصودة: لا شيء هنا يمنح المجهول أكثر مما يملكه العميل الدائم. الفرق
-- الوحيد الذي يُبنى عليه لاحقاً (0006) هو تشديد إضافي على المجهول، لا تخفيف.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ١) carts.user_id — السلة تُملَك بـauth.uid() مباشرة
--
-- يبقى `customer_id` كما هو: حين يتحوّل الزائر إلى طلب فعلي تُربط سلته بصف
-- العميل. لكن الملكية الأمنية لم تعد تمرّ عبره.
-- ---------------------------------------------------------------------------
alter table public.carts
  add column if not exists user_id uuid;

create index if not exists idx_carts_user_id on public.carts (user_id);

-- سلة واحدة مفتوحة لكل مستخدم — نظير `uq_open_cart_per_customer` لكن على
-- المحور الجديد. بدونه يستطيع المجهول أن يفتح سلالاً بلا حدّ.
create unique index if not exists uq_open_cart_per_user
  on public.carts (user_id) where status = 'open' and user_id is not null;

-- القيد القديم `cart_has_owner` يقبل session_token وحده كمالك. وهذا كان صحيحاً
-- حين كان «الضيف» مفهوماً في القاعدة؛ لم يعد كذلك: كل متسوّق الآن موقّع، ولو
-- كمجهول. توسيع القيد ليقبل user_id، مع إبقاء session_token للسلال المهاجَرة.
alter table public.carts drop constraint if exists cart_has_owner;
alter table public.carts add constraint cart_has_owner
  check (customer_id is not null or session_token is not null or user_id is not null);

comment on column public.carts.user_id is
  'auth.users(id) للمالك. هذا هو محور الملكية الأمني للسلة — لا customer_id، '
  'لأن المتسوّق المجهول لا يملك صف customers قبل أول طلب.';

-- ---------------------------------------------------------------------------
-- ٢) دوال ملكية غير قابلة للـNULL
--
-- كل واحدة تُرجع boolean صريحاً. `coalesce(..., false)` ليست تجميلاً: بدونها
-- تُرجع المقارنة NULL لمن لا هوية له، وNULL في تعبير `a or b` قد تنقلب إلى
-- TRUE لو صار `b` صحيحاً في سياسة تُضاف لاحقاً.
-- ---------------------------------------------------------------------------

-- ملاحظة على `set search_path` في الدالتين التاليتين: كلتاهما SECURITY INVOKER،
-- فخطر مسار البحث فيهما أقلّ مما هو في دوال المُعرِّف. لكنهما تُستدعيان من داخل
-- تعبير سياسة RLS، أي في سياق لا يملك المستدعي فيه أن يرى الخطأ ولا أن يشكّ
-- فيه — وهذا أسوأ مكان لسلوك يعتمد على إعداد جلسة. التثبيت هنا رخيص، وفحص
-- Supabase الأمني يرصد غيابه (function_search_path_mutable) على أي حال.

-- هل المستدعي موقّع أصلاً؟ (يشمل المجهول — فالمجهول موقّع.)
create or replace function public.is_signed_in()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select auth.uid() is not null;
$$;

-- هل المستدعي مجهول؟ الادّعاء غائب ⇒ ليس مجهولاً (مستخدم دائم أو خدمة).
create or replace function public.is_anonymous_user()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;

-- ملكية السلة بالمحور الجديد.
create or replace function public.owns_cart(p_cart_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select c.user_id = auth.uid()
        or (c.customer_id is not null and c.customer_id = public.current_customer_id())
    from public.carts c
    where c.id = p_cart_id
  ), false);
$$;

-- الملكية عبر صف العميل، بلا NULL.
create or replace function public.owns_customer_row(p_customer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select c.user_id = auth.uid()
    from public.customers c
    where c.id = p_customer_id
  ), false);
$$;

create or replace function public.owns_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select public.owns_customer_row(o.customer_id)
    from public.orders o
    where o.id = p_order_id
  ), false);
$$;

create or replace function public.owns_custom_request(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select public.owns_customer_row(r.customer_id)
    from public.custom_perfume_requests r
    where r.id = p_request_id
  ), false);
$$;

revoke all on function public.is_signed_in()             from public;
revoke all on function public.is_anonymous_user()        from public;
revoke all on function public.owns_customer_row(uuid)    from public;
revoke all on function public.owns_cart(uuid)            from public;
revoke all on function public.owns_order(uuid)           from public;
revoke all on function public.owns_custom_request(uuid)  from public;

-- تُمنح لأن سياسات RLS تستدعيها بصلاحيات المُستدعي: سحبها يُعطّل الحماية بدل
-- أن يشدّها (نفس المنطق الموثّق في 0004). وهي قراءة فقط، ولا تُرجع إلا ما يخصّ
-- المستدعي: كلها تقارن بـauth.uid() ولا تقبل قيمة تُقارَن بها من الخارج.
grant execute on function public.is_signed_in()            to anon, authenticated, service_role;
grant execute on function public.is_anonymous_user()       to anon, authenticated, service_role;
grant execute on function public.owns_customer_row(uuid)   to anon, authenticated, service_role;
grant execute on function public.owns_cart(uuid)           to anon, authenticated, service_role;
grant execute on function public.owns_order(uuid)          to anon, authenticated, service_role;
grant execute on function public.owns_custom_request(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- ٣) customers — صفّي أنا، وأستطيع إنشاءه، ولا أستطيع نقله
-- ---------------------------------------------------------------------------
drop policy if exists customers_select_own on public.customers;
create policy customers_select_own on public.customers
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- الإنشاء عند أول كتابة: يُسمح بصف واحد لصاحبه. `user_id is not null` مقصود —
-- صف بلا مالك كان سيصبح صفاً يتيماً لا يملكه أحد ولا يستطيع أحد قراءته، وهو
-- بالضبط ما يتركه عميل يحاول الإدراج بلا هوية.
drop policy if exists customers_insert_own on public.customers;
create policy customers_insert_own on public.customers
  for insert to authenticated
  with check (
    (user_id is not null and user_id = auth.uid())
    or public.is_admin()
  );

-- التعديل: مالكاً قبل، ومالكاً بعد. الشرط المزدوج هو ما يمنع نقل `user_id`
-- إلى مستخدم آخر — وهو ثغرة كانت مفتوحة في 0002 (USING تفحص الصف القديم،
-- وWITH CHECK كانت تقبل أي صف يملكه المستدعي، لكن لا شيء منع كتابة user_id
-- الخاص بالضحية… أو بالأحرى: لا شيء منع المستدعي من التخلّي عن صفه لغيره).
drop policy if exists customers_update_own on public.customers;
create policy customers_update_own on public.customers
  for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (
    (user_id is not null and user_id = auth.uid())
    or public.is_admin()
  );

drop policy if exists customers_delete_admin on public.customers;
create policy customers_delete_admin on public.customers
  for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- ٤) carts — سلتي أنا، بمحور auth.uid()
--
-- السياسة مقسّمة لأربع بدل `for all` واحدة: الإدراج يحتاج شرطاً أقوى من
-- القراءة (يجب أن يُكتب user_id صحيحاً)، و`for all` تخلط الاثنين.
-- ---------------------------------------------------------------------------
drop policy if exists carts_own on public.carts;

drop policy if exists carts_select_own on public.carts;
create policy carts_select_own on public.carts
  for select to authenticated
  using (user_id = auth.uid() or public.owns_customer_row(customer_id) or public.is_admin());

drop policy if exists carts_insert_own on public.carts;
create policy carts_insert_own on public.carts
  for insert to authenticated
  with check (
    (user_id is not null and user_id = auth.uid()
     and (customer_id is null or public.owns_customer_row(customer_id)))
    or public.is_admin()
  );

drop policy if exists carts_update_own on public.carts;
create policy carts_update_own on public.carts
  for update to authenticated
  using (user_id = auth.uid() or public.owns_customer_row(customer_id) or public.is_admin())
  with check (
    (user_id = auth.uid()
     and (customer_id is null or public.owns_customer_row(customer_id)))
    or public.is_admin()
  );

drop policy if exists carts_delete_own on public.carts;
create policy carts_delete_own on public.carts
  for delete to authenticated
  using (user_id = auth.uid() or public.owns_customer_row(customer_id) or public.is_admin());

-- ---------------------------------------------------------------------------
-- ٥) cart_items — تتبع سلّتها
--
-- الملكية غير مباشرة عمداً: بند السلة لا يحمل مالكاً خاصاً به، وإنما يرثه من
-- `cart_id`. لو حمل مالكاً مستقلاً لأمكن أن يفترق الاثنان — بند يملكه أ داخل
-- سلة يملكها ب.
-- ---------------------------------------------------------------------------
drop policy if exists cart_items_own on public.cart_items;

drop policy if exists cart_items_select_own on public.cart_items;
create policy cart_items_select_own on public.cart_items
  for select to authenticated
  using (public.owns_cart(cart_id) or public.is_admin());

drop policy if exists cart_items_insert_own on public.cart_items;
create policy cart_items_insert_own on public.cart_items
  for insert to authenticated
  with check (public.owns_cart(cart_id) or public.is_admin());

-- USING تمنع سحب بند من سلة غيري، وWITH CHECK تمنع دفعه إلى سلة غيري.
-- الاثنتان لازمتان: UPDATE واحدة تستطيع نقل `cart_id`.
drop policy if exists cart_items_update_own on public.cart_items;
create policy cart_items_update_own on public.cart_items
  for update to authenticated
  using (public.owns_cart(cart_id) or public.is_admin())
  with check (public.owns_cart(cart_id) or public.is_admin());

drop policy if exists cart_items_delete_own on public.cart_items;
create policy cart_items_delete_own on public.cart_items
  for delete to authenticated
  using (public.owns_cart(cart_id) or public.is_admin());

-- ---------------------------------------------------------------------------
-- ٦) custom_perfume_requests — طلباتي أنا
-- ---------------------------------------------------------------------------
drop policy if exists cpr_own on public.custom_perfume_requests;

drop policy if exists cpr_select_own on public.custom_perfume_requests;
create policy cpr_select_own on public.custom_perfume_requests
  for select to authenticated
  using (public.owns_customer_row(customer_id) or public.is_admin());

drop policy if exists cpr_insert_own on public.custom_perfume_requests;
create policy cpr_insert_own on public.custom_perfume_requests
  for insert to authenticated
  with check (public.owns_customer_row(customer_id) or public.is_admin());

drop policy if exists cpr_update_own on public.custom_perfume_requests;
create policy cpr_update_own on public.custom_perfume_requests
  for update to authenticated
  using (public.owns_customer_row(customer_id) or public.is_admin())
  with check (public.owns_customer_row(customer_id) or public.is_admin());

drop policy if exists cpr_delete_own on public.custom_perfume_requests;
create policy cpr_delete_own on public.custom_perfume_requests
  for delete to authenticated
  using (public.owns_customer_row(customer_id) or public.is_admin());

-- ---------------------------------------------------------------------------
-- ٧) orders / order_items — القراءة للمالك، والكتابة لم تعد من نصيب المتصفّح
--
-- سياسات الإدراج المباشرة تُحذف هنا لا لأنها كانت خاطئة، بل لأن 0007 يستبدلها
-- بمسار واحد ذرّي (place_order). عميل يستطيع `insert into orders` يستطيع أن
-- يخترع `subtotal_fils` — والسياسة لا تفحص مبلغاً، إنما ملكية. سدّ المسار
-- أرخص من محاولة التحقّق من الحساب داخل تعبير سياسة.
-- ---------------------------------------------------------------------------
drop policy if exists orders_insert_own on public.orders;
drop policy if exists order_items_insert_own on public.order_items;

drop policy if exists orders_select_own on public.orders;
create policy orders_select_own on public.orders
  for select to authenticated
  using (public.owns_customer_row(customer_id) or public.is_admin());

drop policy if exists order_items_select_own on public.order_items;
create policy order_items_select_own on public.order_items
  for select to authenticated
  using (public.owns_order(order_id) or public.is_admin());

-- الإدراج للمدير فقط عبر السياسة؛ و0006 يزيل حتى هذا المسار من طبقة الصلاحيات
-- لكل دور عميل، فيبقى service_role وpublic.place_order (SECURITY DEFINER).
drop policy if exists orders_insert_admin on public.orders;
create policy orders_insert_admin on public.orders
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists order_items_insert_admin on public.order_items;
create policy order_items_insert_admin on public.order_items
  for insert to authenticated
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- ٨) الصلاحيات على الأعمدة الجديدة
--
-- GRANT على مستوى الجدول لا يشمل عموداً أُضيف بعده في كل الحالات؛ يُمنح صراحةً.
-- ---------------------------------------------------------------------------
grant select, insert, update (user_id, customer_id, session_token, status)
  on public.carts to authenticated;
grant all on public.carts to service_role;
