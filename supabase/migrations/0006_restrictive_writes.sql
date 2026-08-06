-- ============================================================================
-- RAZEEN V2 STAGING — 0006_restrictive_writes.sql
--
-- طبقتان تفشلان بطريقتين مختلفتين، ولذلك تُستعملان معاً.
-- Two layers that fail differently — which is exactly why both are used.
--
-- المسألة: هناك أشياء لا يجوز أن يكتبها أي جلسة عميل، مجهولةً كانت أو دائمة:
-- حالة الدفع، حالة الطلب، صفوف المدفوعات، حركات المخزون، طابور الإنتاج،
-- الشحنات، سجل التدقيق. في 0002 كان الحاجز هو «غياب سياسة تسمح». وهذا يعمل،
-- لكنه حاجز سلبي: يكفي أن يضيف أحدهم سياسة PERMISSIVE واحدة لاحقاً — بحسن نية،
-- لحلّ حالة استخدام ضيّقة — فينفتح الباب كاملاً. السياسات المسموحة تُجمع بـOR:
-- سياسة واحدة تقول TRUE تكفي.
--
-- الطبقتان:
--
--   ١) REVOKE على مستوى العمود. هذه هي الأداة الدقيقة لـ«هذا العمود ليس لك».
--      تفشل قبل أن تُقيَّم أي سياسة، برسالة `permission denied for column`،
--      ولا تتأثر بأي سياسة تُضاف بعدها. لكنها خشنة في اتجاه واحد: الصلاحية
--      تخصّ الدور لا الشخص، وكل من يوقّع دخوله على Supabase — عميلاً كان أو
--      مديراً — هو الدور `authenticated` نفسه. لذلك انظر الملاحظة (أ) أدناه.
--
--   ٢) سياسات AS RESTRICTIVE. هذه تُجمع بـAND لا بـOR، فهي تنفي مهما أُضيف
--      من مسموحات لاحقاً. وهذا هو بيت القصيد: سياسة مسموحة مستقبلية لا يجوز
--      أن تُعيد فتح ما أُغلق هنا.
--
-- لماذا الاثنتان وليس إحداهما؟ لأن REVOKE يسقط لو أعاد أحدهم GRANT، والسياسة
-- المقيِّدة تسقط لو أسقطها أحدهم عمداً — لكن كلا الفعلين مرئي وصريح، ولا
-- يحدث أحدهما بالمصادفة. أما «نسيان» أن غياب السياسة هو الحماية، فيحدث كل يوم.
-- الاختبارات في tests/rls-mutation-proof.mjs تُطفئ كلاً منهما على حدة وتشترط
-- أن تحمرّ المجموعة في الحالتين.
--
-- ملاحظة (أ) — أين ذهب المدير؟
--   المدير على Supabase ليس دوراً في PostgreSQL؛ هو صفّ في `admin_users`
--   يتصل بالدور `authenticated`. فسحب صلاحية عمود عن `authenticated` يسحبها
--   عن المدير أيضاً — لا مفرّ من ذلك، صلاحيات الأعمدة لا تعرف الأشخاص.
--   والبديل ليس التخلّي عن السحب، بل نقل عمل المدير إلى بابٍ مُعلن: دالتان
--   SECURITY DEFINER في آخر هذا الملف، كلٌّ منهما تتحقّق من is_admin() أولاً.
--   المحصّلة: لا أحد — عميلاً أو مديراً — يكتب هذه الأعمدة بجملة UPDATE
--   مباشرة. الكتابة الوحيدة تمرّ عبر دالة تفحص الهوية وتترك أثراً في
--   audit_logs. وهذا أقوى مما كان، لا أضعف.
--
-- ملاحظة (ب) — التفرقة بين المجهول والدائم.
--   حيث كان للتفرقة معنى، تُستعمل `(auth.jwt() ->> 'is_anonymous')::boolean`
--   لشدّ المجهول أكثر (انظر §٦). أما المنوعات أعلاه فتنطبق على الاثنين بلا
--   استثناء — لأن الخطر فيها ليس «من أنت» بل «ما الذي يُكتب».
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ١) صلاحيات الأعمدة — الأداة الدقيقة
-- ---------------------------------------------------------------------------

-- orders: العمودان اللذان يمثّلان المال والدورة.
--
-- تفصيلة تُفسد الأمر لو أُغفلت: PostgreSQL لا يعرف صلاحية عمود «سالبة». منحُ
-- UPDATE على مستوى الجدول يعني كل الأعمدة، و`REVOKE UPDATE (col)` لا يطرح منه
-- شيئاً — يبقى المنح الجدولي سارياً والعمود مكتوباً. الطريق الصحيح هو سحب
-- المنح الجدولي أولاً ثم إعادة منح الأعمدة المسموحة بالاسم. وهذا ما يجري هنا،
-- ويؤكّده اختبار يقرأ information_schema.column_privileges لا نص هذا الملف.
revoke update on public.orders from authenticated, anon;
revoke update (payment_status, status) on public.orders from authenticated, anon;

-- ما تبقى من أعمدة orders يظلّ قابلاً للتعديل — تحت سياسة المدير في 0002 وحدها،
-- إذ لا سياسة تحديث لغير المدير. العمودان المسحوبان غائبان عن هذه القائمة بقصد.
grant update (
  order_number, customer_id,
  subtotal_fils, shipping_fils, discount_fils, total_fils,
  currency, shipping_address, placed_at, updated_at
) on public.orders to authenticated;

-- المدفوعات: لا كتابة بأي شكل. القراءة (select) تبقى للمالك عبر سياسة 0002.
revoke insert, update, delete on public.payments from authenticated, anon;

-- دفاتر العمليات: لا كتابة من أي جلسة عميل.
revoke insert, update, delete on public.inventory_movements from authenticated, anon;
revoke insert, update, delete on public.production_queue    from authenticated, anon;
revoke insert, update, delete on public.shipments           from authenticated, anon;

-- سجل التدقيق: لا كتابة، وهذا مكمّل لـ0004 الذي أغلق الدالة. الجدول والدالة
-- بابان مستقلان؛ 0004 أغلق الثاني، وهذا يغلق الأول.
revoke insert, update, delete on public.audit_logs from authenticated, anon;

-- صندوق الإرسال التجريبي: يُكتب من المحوّلات الوهمية تحت service_role وحده.
revoke insert, update, delete on public.staging_outbox from authenticated, anon;

-- الطلبات وبنودها: لم يعد للمتصفّح مسار إدراج مباشر إطلاقاً — 0007 يستبدله
-- بـplace_order. والحذف لم يكن له مبرّر أصلاً: طلب مُلغى حالة، لا غياب صف.
revoke insert, delete on public.orders      from authenticated, anon;
revoke insert, delete on public.order_items from authenticated, anon;
revoke update on public.order_items from authenticated, anon;

-- service_role يبقى صاحب كل شيء: هو الخادم الموثوق، ومحوّل الدفع يعمل تحته.
grant all on public.payments, public.inventory_movements, public.production_queue,
             public.shipments, public.audit_logs, public.staging_outbox,
             public.orders, public.order_items
  to service_role;

-- ---------------------------------------------------------------------------
-- ٢) سياسات مقيِّدة — تُجمع بـAND، فلا تُنقَض بسياسة مسموحة لاحقة
--
-- كلها `using (false) with check (false)` على أوامر الكتابة وحدها. القراءة
-- لا تُمسّ عمداً: العميل يجب أن يظلّ يرى حالة طلبه وشحنته ودفعته.
--
-- لماذا سياسات منفصلة لكل أمر بدل `for all`؟ لأن `for all ... using (false)`
-- تشمل SELECT أيضاً فتحجب القراءة المشروعة. الفصل هو ما يجعل النفي دقيقاً.
-- ---------------------------------------------------------------------------

-- ٢-أ) orders — لا تحديث ولا إدراج ولا حذف من جلسة عميل
drop policy if exists orders_no_client_update on public.orders;
create policy orders_no_client_update on public.orders
  as restrictive for update to authenticated, anon
  using (false) with check (false);

drop policy if exists orders_no_client_insert on public.orders;
create policy orders_no_client_insert on public.orders
  as restrictive for insert to authenticated, anon
  with check (false);

drop policy if exists orders_no_client_delete on public.orders;
create policy orders_no_client_delete on public.orders
  as restrictive for delete to authenticated, anon
  using (false);

-- ٢-ب) order_items
drop policy if exists order_items_no_client_write on public.order_items;
create policy order_items_no_client_write on public.order_items
  as restrictive for update to authenticated, anon
  using (false) with check (false);

drop policy if exists order_items_no_client_insert on public.order_items;
create policy order_items_no_client_insert on public.order_items
  as restrictive for insert to authenticated, anon
  with check (false);

drop policy if exists order_items_no_client_delete on public.order_items;
create policy order_items_no_client_delete on public.order_items
  as restrictive for delete to authenticated, anon
  using (false);

-- ٢-ج) الجداول التي لا تُكتب من العميل بأي عمود
do $$
declare
  t text;
begin
  foreach t in array array[
    'payments', 'inventory_movements', 'production_queue',
    'shipments', 'audit_logs', 'staging_outbox'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_no_client_insert', t);
    execute format(
      'create policy %I on public.%I as restrictive for insert to authenticated, anon with check (false)',
      t || '_no_client_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_no_client_update', t);
    execute format(
      'create policy %I on public.%I as restrictive for update to authenticated, anon using (false) with check (false)',
      t || '_no_client_update', t);

    execute format('drop policy if exists %I on public.%I', t || '_no_client_delete', t);
    execute format(
      'create policy %I on public.%I as restrictive for delete to authenticated, anon using (false)',
      t || '_no_client_delete', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- ٣) admin_users — لا ترقية ذاتية، ولا من مجهول بأي حال
--
-- سياسة 0002 تسمح للمدير بكل شيء على الجدول، بما فيه ترقية غيره. يبقى ذلك.
-- المضاف هنا نفيٌ مطلق للمجهول: مستخدم مجهول لا يكتب في admin_users ولو صار
-- مديراً بطريقة ما — وهي حالة لا ينبغي أن توجد، والقيد يجعلها مستحيلة لا
-- مستبعدة.
-- ---------------------------------------------------------------------------
drop policy if exists admin_users_never_anonymous on public.admin_users;
create policy admin_users_never_anonymous on public.admin_users
  as restrictive for all to authenticated, anon
  using (not public.is_anonymous_user())
  with check (not public.is_anonymous_user());

-- ---------------------------------------------------------------------------
-- ٤) الملكية مقيِّدةً — حزام فوق حمّالة
--
-- سياسات 0005 المسموحة تحصر كلاً في صفوفه. هذه تكرّرها كنفي، فتصمد لو أضاف
-- أحدهم سياسة مسموحة أوسع على أي من الجداول الأربعة.
-- ---------------------------------------------------------------------------
drop policy if exists carts_restrict_to_owner on public.carts;
create policy carts_restrict_to_owner on public.carts
  as restrictive for all to authenticated, anon
  using (user_id = auth.uid() or public.owns_customer_row(customer_id) or public.is_admin())
  with check (user_id = auth.uid() or public.owns_customer_row(customer_id) or public.is_admin());

drop policy if exists cart_items_restrict_to_owner on public.cart_items;
create policy cart_items_restrict_to_owner on public.cart_items
  as restrictive for all to authenticated, anon
  using (public.owns_cart(cart_id) or public.is_admin())
  with check (public.owns_cart(cart_id) or public.is_admin());

drop policy if exists customers_restrict_to_owner on public.customers;
create policy customers_restrict_to_owner on public.customers
  as restrictive for all to authenticated, anon
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists orders_restrict_to_owner on public.orders;
create policy orders_restrict_to_owner on public.orders
  as restrictive for all to authenticated, anon
  using (public.owns_customer_row(customer_id) or public.is_admin())
  with check (public.owns_customer_row(customer_id) or public.is_admin());

drop policy if exists order_items_restrict_to_owner on public.order_items;
create policy order_items_restrict_to_owner on public.order_items
  as restrictive for all to authenticated, anon
  using (public.owns_order(order_id) or public.is_admin())
  with check (public.owns_order(order_id) or public.is_admin());

drop policy if exists cpr_restrict_to_owner on public.custom_perfume_requests;
create policy cpr_restrict_to_owner on public.custom_perfume_requests
  as restrictive for all to authenticated, anon
  using (public.owns_customer_row(customer_id) or public.is_admin())
  with check (public.owns_customer_row(customer_id) or public.is_admin());

-- ---------------------------------------------------------------------------
-- ٥) لا صفوف لغير الموقّعين
--
-- المجهول موقّع (auth.uid() موجود)، والزائر غير الموقّع ليس كذلك. هذه تمنع
-- حالة «جلسة بلا هوية» من كتابة أي شيء في جداول الملكية — وهي الحالة التي
-- تُنتج صفوفاً يتيمة لا مالك لها.
-- ---------------------------------------------------------------------------
drop policy if exists customers_requires_identity on public.customers;
create policy customers_requires_identity on public.customers
  as restrictive for insert to authenticated, anon
  with check (public.is_signed_in());

drop policy if exists carts_requires_identity on public.carts;
create policy carts_requires_identity on public.carts
  as restrictive for insert to authenticated, anon
  with check (public.is_signed_in());

-- ---------------------------------------------------------------------------
-- ٦) شدّ إضافي على المجهول وحده
--
-- المجهول حساب مؤقّت بلا وسيلة استرداد: لا بريد ولا هاتف مُثبَت. فما يُفقد
-- بخطئه لا يُستعاد، وما يُنشئه لا يُنسب إلى إنسان يمكن سؤاله. لذلك:
--
--   * لا يحذف صف العميل الخاص به — الحذف يقطع صلته بطلباته وهي الشيء الوحيد
--     الذي يثبت أنه هو. (وهو ممنوع أصلاً بغياب سياسة delete لغير المدير؛
--     هذه تجعله ممنوعاً حتى لو أُضيفت.)
--   * لا يضبط حالة طلب العطر المخصّص إلا 'new' — التسعير والقبول والرفض قرار
--     تشغيلي، لا خانة يملؤها من يطلب. العميل الدائم يخضع للقيد نفسه عملياً
--     عبر سياسات المدير، لكن المجهول يُمنع بنفي صريح.
-- ---------------------------------------------------------------------------
drop policy if exists customers_anon_no_delete on public.customers;
create policy customers_anon_no_delete on public.customers
  as restrictive for delete to authenticated, anon
  using (not public.is_anonymous_user());

drop policy if exists cpr_anon_status_is_new on public.custom_perfume_requests;
create policy cpr_anon_status_is_new on public.custom_perfume_requests
  as restrictive for insert to authenticated, anon
  with check (not public.is_anonymous_user() or status = 'new');

drop policy if exists cpr_anon_status_stays_new on public.custom_perfume_requests;
create policy cpr_anon_status_stays_new on public.custom_perfume_requests
  as restrictive for update to authenticated, anon
  using (not public.is_anonymous_user() or status = 'new')
  with check (not public.is_anonymous_user() or status = 'new');

-- ---------------------------------------------------------------------------
-- ٧) بابا المدير المُعلنان
--
-- نتيجة الملاحظة (أ): عمل المدير لم يُلغَ، بل نُقل من جملة UPDATE مباشرة إلى
-- دالة تتحقّق من الهوية. الفارق العملي أن «من يستطيع» صار سؤالاً يُجاب داخل
-- الدالة (is_admin()) بدل أن يُجاب بصلاحية دور تشمل كل موقّع.
--
-- كلتاهما SECURITY DEFINER بمسار بحث مثبّت، ومُصرَّح بتنفيذها لـauthenticated
-- وحده — لا anon. وكلتاهما تُطلق triggers التدقيق في 0003 كما لو كانت الكتابة
-- مباشرة، فالأثر محفوظ.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_order_status(
  p_order_id       uuid,
  p_status         text default null,
  p_payment_status text default null
) returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
begin
  if not public.is_admin() then
    raise exception 'admin_set_order_status: للمدير وحده'
      using errcode = '42501';
  end if;

  update public.orders o
     set status         = coalesce(p_status, o.status),
         payment_status = coalesce(p_payment_status, o.payment_status)
   where o.id = p_order_id
  returning o.* into v_order;

  if not found then
    raise exception 'admin_set_order_status: لا طلب بهذا المعرّف %', p_order_id
      using errcode = 'P0002';
  end if;

  return v_order;
end;
$$;

create or replace function public.admin_record_inventory_movement(
  p_variant_id uuid,
  p_delta_qty  integer,
  p_reason     text,
  p_order_id   uuid default null,
  p_note       text default null
) returns public.inventory_movements
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.inventory_movements;
begin
  if not public.is_admin() then
    raise exception 'admin_record_inventory_movement: للمدير وحده'
      using errcode = '42501';
  end if;

  insert into public.inventory_movements (variant_id, order_id, delta_qty, reason, note, created_by)
  values (p_variant_id, p_order_id, p_delta_qty, p_reason, p_note, auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

-- `revoke ... from public` وحده لا يكفي على Supabase، وهذا ما أمسكه فحص
-- get_advisors بعد أول تطبيق: للمشروع ALTER DEFAULT PRIVILEGES يمنح EXECUTE
-- لـanon على كل دالة جديدة في public. فالمنح لـanon صريحٌ في proacl، لا موروثٌ
-- من PUBLIC، ولا يسقط بسحب امتياز PUBLIC. لا بدّ من ذكر anon بالاسم.
--
-- الأثر العملي كان محدوداً — الدالتان تفحصان is_admin() أولاً، وanon ليس مديراً —
-- لكن نقطة RPC مكشوفة بلا سبب تبقى سطحاً، والسطح يُقلَّص لا يُبرَّر.
revoke all on function public.admin_set_order_status(uuid, text, text) from public, anon;
revoke all on function public.admin_record_inventory_movement(uuid, integer, text, uuid, text) from public, anon;
grant execute on function public.admin_set_order_status(uuid, text, text)
  to authenticated, service_role;
grant execute on function public.admin_record_inventory_movement(uuid, integer, text, uuid, text)
  to authenticated, service_role;

comment on function public.admin_set_order_status(uuid, text, text) is
  'الباب الوحيد لتغيير orders.status / orders.payment_status من جلسة موقّعة. '
  'يتحقّق من is_admin() ثم يكتب؛ صلاحية العمود مسحوبة عن authenticated في 0006 '
  'فلا مسار مباشر موازٍ. triggers التدقيق في 0003 تعمل كالمعتاد.';

comment on function public.admin_record_inventory_movement(uuid, integer, text, uuid, text) is
  'الباب الوحيد لكتابة حركة مخزون من جلسة موقّعة. يتحقّق من is_admin() ويسجّل '
  'الفاعل في created_by.';
