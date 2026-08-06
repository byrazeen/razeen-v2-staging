-- ============================================================================
-- RAZEEN V2 STAGING — 0007_place_order.sql
--
-- مسار واحد ذرّي لإنشاء الطلب: public.place_order(...)
-- One atomic server-side path for creating an order.
--
-- لماذا؟ لأن الطلب في التصميم السابق كان يُبنى من المتصفّح بأربع كتابات
-- منفصلة: صف في `orders`، صفوف في `order_items`، ثم دفعة، ثم إدخال في طابور
-- الإنتاج. وكل فاصل بين كتابتين هو مكان يمكن أن ينقطع فيه الاتصال أو يُغلق
-- التبويب، فيبقى في القاعدة طلبٌ بلا بنود أو بنودٌ بلا دفعة. والأسوأ: العميل
-- كان يرسل `subtotal_fils` و`total_fils` بنفسه. سياسة RLS تفحص الملكية لا
-- الحساب، فلا شيء في القاعدة كان يمنع طلباً بمجموع صفر.
--
-- ثلاث ضمانات يقدّمها هذا الملف، وكلها مُثبَتة باختبارات لا بادّعاء:
--
--   ١) الذرّية. الدالة كتلة واحدة: إمّا أن يوجد الطلب كاملاً ببنوده ودفعته،
--      أو لا يوجد شيء. لا حالة وسطى.
--
--   ٢) السعر من القاعدة، لا من المتصفّح. المتصفّح يرسل «ماذا» فقط: معرّف
--      المتغيّر، أو رمز الكتالوج والمقاس، والكمية. أي حقل سعر أو مجموع في
--      المُدخل يُتجاهل تماماً — لا يُقرأ ولا يُقارن ولا تُرفض الرسالة بسببه.
--      التجاهل أفضل من الرفض هنا: الرفض يحوّل الحقل إلى قناة إشارة، والتجاهل
--      يجعله عديم الأثر.
--
--   ٣) عدم التكرار. مفتاح idempotency فريد لكل (عميل، مفتاح). النقرة الثانية
--      على «ادفع» — أو إعادة المحاولة بعد انقطاع — تُعيد الطلب نفسه ولا تُنشئ
--      شيئاً. وهذا فرق جوهري عن «تُنشئ طلباً ثانياً متطابقاً».
--
-- سياسة التسعير المطبَّقة هنا هي نفسها المعتمدة في src/lib/pricing.ts، حرفياً:
--   * الجاهز: `product_variants.price_fils` كما هو مخزَّن
--   * المخصّص: 50ml = 28000 فلس · 100ml = 32000 فلس · وما عداهما غير قابل للشراء
--   * سعر ≤ 0 ⇒ غير قابل للشراء (يُرفض، ولا يُخترع له بديل)
--   * الشحن 2500 فلس ثابتة
--   * من ٣ عطور فأكثر (جاهز + مخصّص معاً): شحن 0 وخصم 5% على مجموع العطور،
--     بتقريب النصف لأعلى على الفلس
-- الحساب كلّه بأعداد صحيحة. لا نوع عشري يظهر في هذا الملف إطلاقاً.
--
-- تنبيه بيئة: `p_outcome` يحاكي نتيجة الدفع. لا مزوّد حقيقي هنا ولن يكون —
-- هذه بيئة تجريبية، و`payments.provider` مقيَّد أصلاً بـ('mock','sandbox').
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ١) ثوابت السياسة، كدوال — كي يقرأها الاختبار بدل أن يعيد كتابتها
-- ---------------------------------------------------------------------------
-- `set search_path` على كل واحدة: دوالّ ثابتة لا تقرأ جدولاً، لكن فحص Supabase
-- الأمني يرصد الغياب (function_search_path_mutable)، والتثبيت هنا بلا كلفة.
create or replace function public.shipping_flat_fils() returns integer
  language sql immutable set search_path = public, pg_temp as $$ select 2500 $$;

create or replace function public.bulk_threshold_items() returns integer
  language sql immutable set search_path = public, pg_temp as $$ select 3 $$;

create or replace function public.bulk_discount_percent() returns integer
  language sql immutable set search_path = public, pg_temp as $$ select 5 $$;

-- تقريب النصف لأعلى على الفلس — نظير roundHalfUpFils في pricing.ts، بالصيغة
-- نفسها: floor((n*2 + d) / (d*2)). حساب صحيح بالكامل، بلا numeric ولا round().
-- استعمال round() على numeric يقرّب نصف-إلى-الزوجي في بعض المسارات، فينحرف عن
-- المتصفّح بفلس واحد في الحالات الحديّة — وفلس واحد يكفي ليتّهم أحدهم الآخر.
create or replace function public.round_half_up_fils(p_numerator bigint, p_denominator bigint)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_denominator <= 0 then null
    else ((p_numerator * 2 + p_denominator) / (p_denominator * 2))::integer
  end;
$$;

create or replace function public.percent_of_fils(p_amount_fils bigint, p_percent integer)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select public.round_half_up_fils(p_amount_fils * p_percent, 100);
$$;

-- سعر العطر المخصّص حسب المقاس. NULL ⇒ غير قابل للشراء.
create or replace function public.custom_price_fils(p_size text)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_size
    when '50ml'  then 28000
    when '100ml' then 32000
    else null
  end;
$$;

-- ---------------------------------------------------------------------------
-- ٢) مفتاح عدم التكرار
--
-- العمود على `orders` لا في جدول جانبي: الطلب نفسه هو ما لا يجوز أن يتكرّر،
-- وجدول جانبي كان سيسمح بوجود مفتاح بلا طلب أو طلب بلا مفتاح.
--
-- الفهرس فريد على (customer_id, idempotency_key) لا على المفتاح وحده: مفتاحان
-- متطابقان من عميلين مختلفين حادثة عادية (uuid عميل قد يولّده المتصفّح بالطريقة
-- نفسها)، ولا سبب لأن يمنع أحدهما الآخر. الشرط الجزئي `is not null` يبقي
-- الطلبات القديمة والإدارية خارج القيد.
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists idempotency_key text;

create unique index if not exists uq_orders_idempotency
  on public.orders (customer_id, idempotency_key)
  where idempotency_key is not null;

comment on column public.orders.idempotency_key is
  'مفتاح يرسله العميل لكل محاولة دفع. إعادة الاستدعاء بالمفتاح نفسه تُعيد '
  'الطلب نفسه ولا تُنشئ صفاً جديداً. فريد لكل (customer_id, key).';

-- تسلسل أرقام الطلبات. يبدأ من 2000 كي لا يصطدم بأرقام البذرة (STG-1001..1003).
create sequence if not exists public.order_number_seq start with 2000 increment by 1;

-- ---------------------------------------------------------------------------
-- ٣) place_order
-- ---------------------------------------------------------------------------
create or replace function public.place_order(
  p_items           jsonb,
  p_customer        jsonb default '{}'::jsonb,
  p_idempotency_key text    default null,
  p_outcome         text    default 'success'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid            uuid := auth.uid();
  v_key            text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_outcome        text := lower(btrim(coalesce(p_outcome, 'success')));
  v_customer_id    uuid;
  v_existing       public.orders;

  v_item           jsonb;
  v_kind           text;
  v_qty            integer;
  v_unit_fils      integer;
  v_title          text;
  v_variant_id     uuid;
  v_catalog_id     uuid;
  v_size           text;
  v_free_text      text;
  v_request_id     uuid;

  v_item_count     integer := 0;
  v_subtotal       bigint  := 0;
  v_discount       integer := 0;
  v_shipping       integer := 0;
  v_total          bigint  := 0;

  v_order_id       uuid;
  v_order_number   text;
  v_order_status   text;
  v_payment_status text;
  v_payment_state  text;

  -- البنود بعد التسعير من القاعدة. تُجمَّع أولاً لأن الخصم يعتمد على مجموع
  -- الكميات، وهو غير معروف قبل انتهاء الحلقة — فلا يمكن إدراج أي بند قبلها.
  v_priced         jsonb   := '[]'::jsonb;
  v_priced_item    jsonb;
begin
  -- ٣-أ) الهوية. المجهول مقبول (auth.uid() موجود له)؛ غير الموقّع مرفوض.
  if v_uid is null then
    raise exception 'place_order: يلزم تسجيل الدخول'
      using errcode = '42501';
  end if;

  if v_outcome not in ('success', 'failed') then
    raise exception 'place_order: p_outcome يجب أن يكون success أو failed (وصل %)', p_outcome
      using errcode = '22023';
  end if;

  if v_key is null then
    raise exception 'place_order: p_idempotency_key مطلوب'
      using errcode = '22023';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'place_order: p_items يجب أن يكون مصفوفة غير فارغة'
      using errcode = '22023';
  end if;

  -- ٣-ب) صف العميل: يوجد أو يُنشأ. مربوط بـauth.uid() دائماً، فلا يمكن
  -- للمستدعي أن يشير إلى عميل آخر — لا يوجد وسيط يقبل customer_id أصلاً.
  select id into v_customer_id from public.customers where user_id = v_uid;

  if v_customer_id is null then
    if nullif(btrim(coalesce(p_customer ->> 'full_name', '')), '') is null
       or nullif(btrim(coalesce(p_customer ->> 'phone', '')), '') is null then
      raise exception 'place_order: أول طلب يحتاج full_name وphone في p_customer'
        using errcode = '22023';
    end if;

    begin
      insert into public.customers
        (user_id, full_name, phone, email, emirate, area, street, building, flat)
      values (
        v_uid,
        btrim(p_customer ->> 'full_name'),
        btrim(p_customer ->> 'phone'),
        nullif(btrim(coalesce(p_customer ->> 'email', '')), ''),
        nullif(btrim(coalesce(p_customer ->> 'emirate', '')), ''),
        nullif(btrim(coalesce(p_customer ->> 'area', '')), ''),
        nullif(btrim(coalesce(p_customer ->> 'street', '')), ''),
        nullif(btrim(coalesce(p_customer ->> 'building', '')), ''),
        nullif(btrim(coalesce(p_customer ->> 'flat', '')), '')
      )
      returning id into v_customer_id;
    exception when unique_violation then
      -- سباق بين نافذتين للمستخدم نفسه، أو هاتف مستعمل من حساب آخر.
      select id into v_customer_id from public.customers where user_id = v_uid;
      if v_customer_id is null then
        raise exception 'place_order: رقم الهاتف مستعمل في حساب آخر'
          using errcode = '23505';
      end if;
    end;
  else
    -- تحديث العنوان إن أُرسل. الحقول الغائبة تبقى كما هي: طلب لاحق بعنوان
    -- ناقص يجب ألّا يمحو عنواناً صحيحاً سابقاً.
    update public.customers c
       set full_name = coalesce(nullif(btrim(coalesce(p_customer ->> 'full_name', '')), ''), c.full_name),
           email     = coalesce(nullif(btrim(coalesce(p_customer ->> 'email',     '')), ''), c.email),
           emirate   = coalesce(nullif(btrim(coalesce(p_customer ->> 'emirate',   '')), ''), c.emirate),
           area      = coalesce(nullif(btrim(coalesce(p_customer ->> 'area',      '')), ''), c.area),
           street    = coalesce(nullif(btrim(coalesce(p_customer ->> 'street',    '')), ''), c.street),
           building  = coalesce(nullif(btrim(coalesce(p_customer ->> 'building',  '')), ''), c.building),
           flat      = coalesce(nullif(btrim(coalesce(p_customer ->> 'flat',      '')), ''), c.flat)
     where c.id = v_customer_id;
  end if;

  -- ٣-ج) عدم التكرار — الفحص المبكر. يلتقط الحالة الشائعة (نقرة ثانية بعد أن
  -- نجحت الأولى) دون أي عمل. الحالة النادرة (استدعاءان متزامنان) يلتقطها
  -- الفهرس الفريد في ٣-ز.
  select * into v_existing
    from public.orders
   where customer_id = v_customer_id and idempotency_key = v_key;

  if found then
    return jsonb_build_object(
      'order_id',       v_existing.id,
      'order_number',   v_existing.order_number,
      'status',         v_existing.status,
      'payment_status', v_existing.payment_status,
      'subtotal_fils',  v_existing.subtotal_fils,
      'discount_fils',  v_existing.discount_fils,
      'shipping_fils',  v_existing.shipping_fils,
      'total_fils',     v_existing.total_fils,
      'currency',       v_existing.currency,
      'idempotent_replay', true
    );
  end if;

  -- ٣-د) التسعير من القاعدة.
  --
  -- كل ما يصل من المتصفّح هنا هو: النوع، المعرّف/الرمز، المقاس، الكمية. أي
  -- مفتاح آخر في عنصر البند — unit_price_fils، price، line_total، total —
  -- لا يُقرأ في أي سطر مما يلي. هذا هو موضع الضمان (٢) حرفياً.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_variant_id := null;
    v_catalog_id := null;
    v_request_id := null;
    v_size       := nullif(btrim(coalesce(v_item ->> 'size', v_item ->> 'bottle_size', '')), '');
    v_free_text  := nullif(btrim(coalesce(v_item ->> 'free_text', v_item ->> 'free_text_request', '')), '');

    -- الكمية: عدد صحيح موجب. `::integer` على نص غير رقمي يرفع خطأً، وهو
    -- المطلوب — كمية غير مفهومة ليست كمية 1.
    begin
      v_qty := (v_item ->> 'quantity')::integer;
    exception when others then
      raise exception 'place_order: كمية غير صالحة في البند %', v_item
        using errcode = '22023';
    end;
    if v_qty is null or v_qty <= 0 then
      raise exception 'place_order: الكمية يجب أن تكون عدداً صحيحاً موجباً (وصل %)',
        coalesce(v_item ->> 'quantity', 'null') using errcode = '22023';
    end if;

    -- النوع: صريح إن أُرسل، ومستنتَج من وجود variant_id إن لم يُرسل.
    v_kind := lower(coalesce(nullif(btrim(coalesce(v_item ->> 'kind', '')), ''),
                             case when (v_item ->> 'variant_id') is not null
                                  then 'ready' else 'custom' end));

    if v_kind = 'ready' then
      begin
        v_variant_id := (v_item ->> 'variant_id')::uuid;
      exception when others then
        raise exception 'place_order: variant_id غير صالح في البند %', v_item
          using errcode = '22023';
      end;

      -- السعر المخزَّن حرفياً، والعنوان لقطةً وقت البيع.
      select v.price_fils,
             coalesce(p.title_ar, p.title_en, v.sku) || ' · ' || v.bottle_size
        into v_unit_fils, v_title
        from public.product_variants v
        join public.products p on p.id = v.product_id
       where v.id = v_variant_id
         and v.is_active
         and p.is_available;

      if not found then
        raise exception 'place_order: المتغيّر % غير موجود أو غير متاح للشراء', v_variant_id
          using errcode = '22023';
      end if;

      -- قاعدة «سعر ≤ 0 ⇒ غير قابل للشراء»: يُرفض البند، ولا يُسعَّر بديلاً
      -- ولا يُحذف بصمت. الحذف الصامت كان سيُنتج طلباً لا يطابق ما رآه العميل.
      if v_unit_fils is null or v_unit_fils <= 0 then
        raise exception 'place_order: المتغيّر % غير قابل للشراء (سعر %)',
          v_variant_id, coalesce(v_unit_fils::text, 'null') using errcode = '22023';
      end if;

    elsif v_kind = 'custom' then
      -- المقاسان المعتمدان وحدهما. 200ml موجود في `product_variants` للجاهز،
      -- لكنه ليس مقاساً مخصّصاً معتمداً — والسياسة صريحة في ذلك.
      v_unit_fils := public.custom_price_fils(v_size);
      if v_unit_fils is null then
        raise exception 'place_order: المقاس % غير معتمد للعطر المخصّص (المعتمد: 50ml أو 100ml)',
          coalesce(v_size, 'null') using errcode = '22023';
      end if;

      if nullif(btrim(coalesce(v_item ->> 'catalog_code', '')), '') is not null then
        select c.id, '[مخصّص] ' || c.perfume_name || ' · ' || v_size
          into v_catalog_id, v_title
          from public.perfume_catalog c
         where c.code = btrim(v_item ->> 'catalog_code') and c.is_active;
        if not found then
          raise exception 'place_order: رمز الكتالوج % غير موجود أو غير مفعّل',
            v_item ->> 'catalog_code' using errcode = '22023';
        end if;
      elsif v_free_text is not null then
        v_title := '[مخصّص] ' || left(v_free_text, 80) || ' · ' || v_size;
      else
        raise exception 'place_order: البند المخصّص يحتاج catalog_code أو free_text'
          using errcode = '22023';
      end if;

      -- طلب العطر المخصّص يُنشأ هنا لا في المتصفّح، ويُسعَّر بالسعر المحسوب
      -- أعلاه — فـ`quoted_price_fils` لا يمكن أن يفارق `unit_price_fils`.
      insert into public.custom_perfume_requests
        (customer_id, catalog_id, free_text_request, bottle_size, quantity,
         quoted_price_fils, status, customer_notes)
      values (v_customer_id, v_catalog_id, v_free_text, v_size, v_qty,
              v_unit_fils, 'new', nullif(btrim(coalesce(v_item ->> 'notes', '')), ''))
      returning id into v_request_id;

    else
      raise exception 'place_order: نوع بند غير معروف % (المتوقّع ready أو custom)', v_kind
        using errcode = '22023';
    end if;

    v_item_count := v_item_count + v_qty;
    v_subtotal   := v_subtotal + (v_unit_fils::bigint * v_qty);

    v_priced := v_priced || jsonb_build_array(jsonb_build_object(
      'variant_id',        v_variant_id,
      'custom_request_id', v_request_id,
      'title',             v_title,
      'quantity',          v_qty,
      'unit_price_fils',   v_unit_fils,
      'line_total_fils',   v_unit_fils::bigint * v_qty
    ));
  end loop;

  -- ٣-هـ) المجاميع — الحدّ عند ٣ محسوب من مجموع الكميات، لا من عدد البنود.
  -- بندٌ واحد بكمية ٣ هو ثلاثة عطور، والعميل يراها ثلاثة.
  if v_item_count >= public.bulk_threshold_items() then
    v_discount := public.percent_of_fils(v_subtotal, public.bulk_discount_percent());
    v_shipping := 0;
  else
    v_discount := 0;
    v_shipping := public.shipping_flat_fils();
  end if;
  v_total := v_subtotal - v_discount + v_shipping;

  -- ٣-و) نتيجة الدفع المحاكاة.
  if v_outcome = 'success' then
    v_order_status   := 'paid';
    v_payment_status := 'paid';
    v_payment_state  := 'paid';
  else
    v_order_status   := 'failed';
    v_payment_status := 'failed';
    v_payment_state  := 'failed';
  end if;

  -- ٣-ز) الكتابة. كتلة واحدة: كل ما يلي ينجح معاً أو لا يحدث منه شيء.
  begin
    v_order_number := 'STG-' || nextval('public.order_number_seq')::text;

    insert into public.orders
      (order_number, customer_id, status, payment_status,
       subtotal_fils, shipping_fils, discount_fils, total_fils,
       shipping_address, idempotency_key)
    values (
      v_order_number, v_customer_id, v_order_status, v_payment_status,
      v_subtotal::integer, v_shipping, v_discount, v_total::integer,
      jsonb_strip_nulls(jsonb_build_object(
        'emirate',  coalesce(nullif(btrim(coalesce(p_customer ->> 'emirate',  '')), ''), (select emirate  from public.customers where id = v_customer_id)),
        'area',     coalesce(nullif(btrim(coalesce(p_customer ->> 'area',     '')), ''), (select area     from public.customers where id = v_customer_id)),
        'street',   coalesce(nullif(btrim(coalesce(p_customer ->> 'street',   '')), ''), (select street   from public.customers where id = v_customer_id)),
        'building', coalesce(nullif(btrim(coalesce(p_customer ->> 'building', '')), ''), (select building from public.customers where id = v_customer_id)),
        'flat',     coalesce(nullif(btrim(coalesce(p_customer ->> 'flat',     '')), ''), (select flat     from public.customers where id = v_customer_id))
      )),
      v_key
    )
    returning id into v_order_id;
  exception when unique_violation then
    -- استدعاءان متزامنان بالمفتاح نفسه. الخاسر يتراجع كاملاً (كتلة EXCEPTION
    -- في plpgsql معاملة فرعية) ثم يُعيد الطلب الذي كتبه الفائز. النتيجة
    -- المرئية للطرفين واحدة، وهو بالضبط تعريف idempotency.
    select * into v_existing
      from public.orders
     where customer_id = v_customer_id and idempotency_key = v_key;
    if not found then
      raise;
    end if;
    return jsonb_build_object(
      'order_id',       v_existing.id,
      'order_number',   v_existing.order_number,
      'status',         v_existing.status,
      'payment_status', v_existing.payment_status,
      'subtotal_fils',  v_existing.subtotal_fils,
      'discount_fils',  v_existing.discount_fils,
      'shipping_fils',  v_existing.shipping_fils,
      'total_fils',     v_existing.total_fils,
      'currency',       v_existing.currency,
      'idempotent_replay', true
    );
  end;

  -- بنود الطلب، بالأسعار المحسوبة أعلاه لا المرسَلة.
  for v_priced_item in select * from jsonb_array_elements(v_priced) loop
    insert into public.order_items
      (order_id, variant_id, custom_request_id, title_snapshot,
       quantity, unit_price_fils, line_total_fils)
    values (
      v_order_id,
      nullif(v_priced_item ->> 'variant_id', '')::uuid,
      nullif(v_priced_item ->> 'custom_request_id', '')::uuid,
      v_priced_item ->> 'title',
      (v_priced_item ->> 'quantity')::integer,
      (v_priced_item ->> 'unit_price_fils')::integer,
      (v_priced_item ->> 'line_total_fils')::integer
    );
  end loop;

  -- دفعة وهمية. لا مزوّد، ولا نداء شبكة، ولا مفتاح سرّي — وهذا شرط البيئة
  -- لا نقص فيها.
  insert into public.payments (order_id, provider, intent_id, status, amount_fils, raw_response)
  values (
    v_order_id, 'mock', 'stg_' || replace(v_order_id::text, '-', ''),
    v_payment_state, v_total::integer,
    jsonb_build_object('simulated', true, 'outcome', v_outcome, 'environment', 'staging')
  );

  -- ٣-ح) طابور الإنتاج للمدفوع وحده.
  --
  -- الشرط مكتوب هنا صراحةً رغم وجود trigger في 0001 يفرضه. التكرار مقصود:
  -- الاعتماد على الـtrigger وحده يعني أن الطلب الفاشل يحاول الدخول ثم يُرفض
  -- بخطأ يُسقط المعاملة كلها — فيفشل تسجيل الطلب الفاشل نفسه. الفحص المسبق
  -- يجعل «لا يدخل» سلوكاً عادياً لا استثناءً.
  if v_payment_status = 'paid' then
    insert into public.production_queue (order_id, status)
    values (v_order_id, 'queued');
  end if;

  -- تحويل سلة المستخدم المفتوحة إلى «محوَّلة»، وربطها بصف العميل. السلة لم تعد
  -- في localStorage، فلا بدّ لها من نهاية معلنة.
  update public.carts
     set status = 'converted', customer_id = coalesce(customer_id, v_customer_id)
   where status = 'open'
     and (user_id = v_uid or customer_id = v_customer_id);

  return jsonb_build_object(
    'order_id',       v_order_id,
    'order_number',   v_order_number,
    'status',         v_order_status,
    'payment_status', v_payment_status,
    'subtotal_fils',  v_subtotal::integer,
    'discount_fils',  v_discount,
    'shipping_fils',  v_shipping,
    'total_fils',     v_total::integer,
    'item_count',     v_item_count,
    'currency',       'AED',
    'idempotent_replay', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- ٤) سطح الاستدعاء
--
-- `authenticated` وحده. لا anon: زائر لم يوقّع دخوله (ولو كمجهول) ليس له
-- auth.uid()، وكانت الدالة سترفضه على أي حال — لكن رفضٌ بلا صلاحية أنظف من
-- رفضٍ داخل الجسم، ويُبقي الدالة خارج سطح RPC العام.
-- ---------------------------------------------------------------------------
revoke all on function public.place_order(jsonb, jsonb, text, text) from public, anon;
grant execute on function public.place_order(jsonb, jsonb, text, text) to authenticated;

-- دوال السياسة الثابتة: قراءة أرقام معلنة، لا سرّ فيها، والاختبارات تقرأها.
revoke all on function public.round_half_up_fils(bigint, bigint) from public;
revoke all on function public.percent_of_fils(bigint, integer)   from public;
revoke all on function public.custom_price_fils(text)            from public;
grant execute on function public.shipping_flat_fils()             to anon, authenticated, service_role;
grant execute on function public.bulk_threshold_items()           to anon, authenticated, service_role;
grant execute on function public.bulk_discount_percent()          to anon, authenticated, service_role;
grant execute on function public.round_half_up_fils(bigint, bigint) to authenticated, service_role;
grant execute on function public.percent_of_fils(bigint, integer)   to authenticated, service_role;
grant execute on function public.custom_price_fils(text)            to anon, authenticated, service_role;

grant usage on sequence public.order_number_seq to service_role;

comment on function public.place_order(jsonb, jsonb, text, text) is
  'المسار الوحيد لإنشاء طلب من جلسة موقّعة. يُسعّر من القاعدة ويتجاهل أي سعر '
  'يصل من العميل، ويحسب الخصم والشحن والمجموع، ويكتب orders + order_items + '
  'payments ذرّياً، ويُدخل المدفوع وحده في production_queue. إعادة الاستدعاء '
  'بالمفتاح نفسه تُعيد الطلب نفسه بلا إنشاء.';
