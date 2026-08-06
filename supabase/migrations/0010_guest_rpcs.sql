-- ============================================================================
-- RAZEEN V2 STAGING — 0010_guest_rpcs.sql
--
-- الأبواب. كل عملية يقوم بها الضيف هي دالة SECURITY DEFINER تتحقّق من الرمز
-- بنفسها، ولا شيء غيرها.
-- Every guest operation is a SECURITY DEFINER RPC that verifies the token.
--
-- 0009 بنى الحالة (الجدول، المحور، النفي). هذا الملف يبني الأبواب الخمسة:
-- إصدار الرمز · السلة · العطر المخصّص · إنشاء الطلب · قراءة حالة الطلب.
--
-- ---------------------------------------------------------------------------
-- ثلاثة مبادئ تحكم كل دالة هنا:
--
--   ١) الرمز يُتحقَّق منه أولاً، بثلاثة أخطاء متمايزة لا خطأ واحد غامض:
--        GUEST_TOKEN_UNKNOWN — لا جلسة بهذا الهاش (مزوّر، أو حُذفت جلسته)
--        GUEST_TOKEN_REVOKED — جلسة أُبطلت عمداً
--        GUEST_TOKEN_EXPIRED — جلسة انقضى عمرها
--      لماذا التمييز؟ لأن الواجهة تتصرّف تصرّفاً مختلفاً في كل حالة: المنتهي
--      يُستبدل بصمت، والمُبطل يُخبَر صاحبه، والمجهول خطأ برمجي يستحق أن
--      يُرى. رسالة واحدة لثلاث حالات تعني أن الواجهة ستُعامل الثلاث بأسوأها.
--      (وما يُسرَّب بهذا التمييز لا يُذكر: من يملك الرمز يعرف حالته أصلاً،
--      ومن لا يملكه يحصل على UNKNOWN في كل الأحوال.)
--
--   ٢) السعر من القاعدة دائماً. لا دالة هنا تقبل سعراً من المستدعي، لا في
--      السلة ولا في الطلب. الضمانة نفسها المشروحة في 0007 §٢، ممتدّةً إلى
--      المحور الجديد.
--
--   ٣) لا نسخة ثانية من منطق الطلب. `place_order` في 0007 كانت تفعل شيئين:
--      تحلّ الهوية، ثم تُنشئ الطلب. الهوية وحدها هي ما يختلف بين الموقّع
--      والضيف. فيُفصل الجزء الثاني إلى `place_order_core` ويُستدعى من
--      المسارين. نسختان من حساب التسعير كانتا ستفترقان — لا احتمالاً بل
--      حتماً، عند أول تعديل يُطبَّق على إحداهما.
--
-- ---------------------------------------------------------------------------
-- ملاحظة على search_path:
--   `gen_random_bytes` من pgcrypto، وهو مثبَّت في مخطط `extensions` على
--   Supabase وفي `public` على قاعدة الاختبار المحلّية. فمسار البحث يذكر
--   الاثنين — ومخطط غير موجود في المسار يُتجاهل بلا خطأ، فالسطر نفسه يعمل في
--   البيئتين. أمّا `sha256` فمن pg_catalog، حاضر دائماً بلا تأهيل.
--
-- ملاحظة على المدير:
--   لا شيء في هذا الملف يمسّ مسار الإدارة. `admin_set_order_status` و
--   `admin_record_inventory_movement` كما هما، ولا دالة ضيف تقبل رمزاً
--   إدارياً ولا تمنح صلاحية إدارية. لوحة الإدارة لا تحمل رمز ضيف إطلاقاً.
-- ============================================================================

-- ===========================================================================
-- ١) الهاش والتحقّق
-- ===========================================================================

create or replace function public.guest_token_hash(p_token text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex');
$$;

-- يُرجع معرّف الجلسة أو يرفع أحد الأخطاء الثلاثة. لا يُحدّث last_seen_at:
-- التحقّق قد يفشل، و«آخر ظهور» يجب أن يعني «نجحت عملية» لا «وصلت محاولة».
create or replace function public.guest_session_id_for(p_token text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.guest_sessions;
begin
  if nullif(btrim(coalesce(p_token, '')), '') is null then
    raise exception 'GUEST_TOKEN_UNKNOWN: رمز الضيف مفقود أو فارغ'
      using errcode = '42501';
  end if;

  select * into v_row
    from public.guest_sessions
   where token_hash = public.guest_token_hash(p_token);

  if not found then
    raise exception 'GUEST_TOKEN_UNKNOWN: لا جلسة ضيف بهذا الرمز'
      using errcode = '42501';
  end if;

  -- الترتيب مقصود: الإبطال قبل الانقضاء. جلسة أُبطلت ثم انقضت هي مُبطلة،
  -- والإبطال قرار اتُّخذ بينما الانقضاء حدث مرّ.
  if v_row.revoked_at is not null then
    raise exception 'GUEST_TOKEN_REVOKED: جلسة الضيف أُبطلت في %', v_row.revoked_at
      using errcode = '42501';
  end if;

  if v_row.expires_at <= now() then
    raise exception 'GUEST_TOKEN_EXPIRED: انقضت جلسة الضيف في %', v_row.expires_at
      using errcode = '42501';
  end if;

  return v_row.id;
end;
$$;

-- «رأيتك». تُستدعى بعد نجاح العملية لا قبلها.
create or replace function public.guest_touch(p_session_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.guest_sessions set last_seen_at = now() where id = p_session_id;
$$;

-- ===========================================================================
-- ٢) issue_guest_token — الموضع الوحيد في عمر النظام الذي يوجد فيه الرمز الخام
-- ===========================================================================
create or replace function public.issue_guest_token()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_window_secs bigint  := extract(epoch from public.guest_issue_window())::bigint;
  v_bucket      timestamptz;
  v_issued      integer;
  v_token       text;
  v_id          uuid;
  v_expires     timestamptz;
begin
  -- ٢-أ) السقف العالمي. الزيادة والفحص في جملة واحدة ذرّية: `on conflict do
  -- update` يقفل الصف، فاستدعاءان متزامنان يتسلسلان ولا يقرأ أحدهما عدّاداً
  -- بائتاً. والرفع بعد الزيادة يتراجع عنها معه — أي أن المحاولة المرفوضة لا
  -- تُحصى، فالسقف يبقى دقيقاً عند العدد المسموح لا أقلّ منه.
  v_bucket := to_timestamp(floor(extract(epoch from now()) / v_window_secs) * v_window_secs);

  insert into public.guest_issue_counters (window_start, issued)
  values (v_bucket, 1)
  on conflict (window_start) do update
    set issued = public.guest_issue_counters.issued + 1
  returning issued into v_issued;

  if v_issued > public.guest_issue_cap() then
    raise exception
      'GUEST_ISSUE_RATE_LIMIT: تجاوز سقف إصدار جلسات الضيوف (% لكل %)',
      public.guest_issue_cap(), public.guest_issue_window()
      using errcode = '53400';
  end if;

  -- ٢-ب) الرمز. ٣٢ بايتاً عشوائية من مولّد صالح للتعمية = ٢٥٦ بت عشوائية.
  -- التخمين مستحيل عملياً، والسابقة تجعل الرمز مميَّزاً في أي سجل يظهر فيه
  -- بالخطأ فيُمسح — رمزٌ لا يُعرف شكله يبقى في السجلات إلى الأبد.
  v_token   := 'rzn_guest_' || encode(gen_random_bytes(32), 'hex');
  v_expires := now() + public.guest_session_ttl();

  insert into public.guest_sessions (token_hash, expires_at)
  values (public.guest_token_hash(v_token), v_expires)
  returning id into v_id;

  -- الرمز الخام يخرج هنا، مرّةً واحدة، ولا يُكتب في أي جدول. لا استدعاء بعد
  -- هذا يستطيع استرجاعه — لا من هذه الدالة ولا من غيرها.
  return jsonb_build_object(
    'token',      v_token,
    'session_id', v_id,
    'expires_at', v_expires
  );
end;
$$;

-- إبطال ذاتي: من يملك الرمز يستطيع إنهاء جلسته. لا يحتاج صلاحية أعلى — هو
-- يستطيع رمي الرمز على أي حال، والإبطال يجعل الرمي نهائياً في القاعدة أيضاً.
create or replace function public.guest_revoke_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := public.guest_session_id_for(p_token);
begin
  update public.guest_sessions
     set revoked_at = now(), last_seen_at = now()
   where id = v_id;
  return jsonb_build_object('session_id', v_id, 'revoked', true);
end;
$$;

-- ===========================================================================
-- ٣) السلة
-- ===========================================================================

-- سلة الجلسة المفتوحة، تُنشأ إن لم توجد. الفهرس الفريد
-- uq_open_cart_per_guest_session يضمن ألّا تُنشأ ثانية في سباق.
create or replace function public.guest_cart_id(p_session_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cart uuid;
begin
  select id into v_cart
    from public.carts
   where guest_session_id = p_session_id and status = 'open';

  if v_cart is null then
    begin
      insert into public.carts (guest_session_id, status)
      values (p_session_id, 'open')
      returning id into v_cart;
    exception when unique_violation then
      select id into v_cart
        from public.carts
       where guest_session_id = p_session_id and status = 'open';
    end;
  end if;

  return v_cart;
end;
$$;

-- قراءة السلة. الأسعار المُعادة من `product_variants` / `custom_price_fils`
-- لا من `cart_items.unit_price_fils` وحده — البند قد يكون مخزَّناً منذ أسبوع
-- وسعر الرفّ تغيّر. والطلب يُسعَّر من القاعدة على أي حال (0007)، فالسلة التي
-- تعرض سعراً بائتاً كانت ستُفاجئ صاحبها عند الدفع.
create or replace function public.guest_get_cart(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session uuid := public.guest_session_id_for(p_token);
  v_cart    uuid := public.guest_cart_id(v_session);
  v_items   jsonb;
begin
  select coalesce(jsonb_agg(x order by x ->> 'created_at'), '[]'::jsonb) into v_items
  from (
    select jsonb_build_object(
      'item_id',           i.id,
      'kind',              case when i.variant_id is not null then 'ready' else 'custom' end,
      'variant_id',        i.variant_id,
      'custom_request_id', i.custom_request_id,
      'title',             coalesce(
                             p.title_ar || ' · ' || v.bottle_size,
                             '[مخصّص] ' || coalesce(pc.perfume_name, left(r.free_text_request, 80))
                               || ' · ' || r.bottle_size),
      'quantity',          i.quantity,
      'unit_price_fils',   coalesce(v.price_fils, public.custom_price_fils(r.bottle_size)),
      'created_at',        i.created_at
    ) as x
    from public.cart_items i
    left join public.product_variants v on v.id = i.variant_id
    left join public.products p         on p.id = v.product_id
    left join public.custom_perfume_requests r on r.id = i.custom_request_id
    left join public.perfume_catalog pc on pc.id = r.catalog_id
    where i.cart_id = v_cart
  ) s;

  perform public.guest_touch(v_session);

  return jsonb_build_object('cart_id', v_cart, 'items', v_items);
end;
$$;

-- ضبط كمية متغيّر جاهز. الكمية صفر تحذف البند — «احذف» و«اجعلها صفراً» فعل
-- واحد في ذهن المستعمل، ودالتان له كانتا ستختلفان في الحالات الحدّية.
--
-- لا وسيط سعر هنا، ولا في أي مكان. `unit_price_fils` يُقرأ من الرفّ.
create or replace function public.guest_set_cart_item(
  p_token      text,
  p_variant_id uuid,
  p_quantity   integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session uuid := public.guest_session_id_for(p_token);
  v_cart    uuid;
  v_price   integer;
begin
  if p_quantity is null or p_quantity < 0 then
    raise exception 'guest_set_cart_item: الكمية يجب أن تكون صفراً أو أكثر (وصل %)',
      coalesce(p_quantity::text, 'null') using errcode = '22023';
  end if;

  v_cart := public.guest_cart_id(v_session);

  if p_quantity = 0 then
    delete from public.cart_items where cart_id = v_cart and variant_id = p_variant_id;
    perform public.guest_touch(v_session);
    return public.guest_get_cart(p_token);
  end if;

  select v.price_fils into v_price
    from public.product_variants v
    join public.products p on p.id = v.product_id
   where v.id = p_variant_id and v.is_active and p.is_available;

  if not found or v_price is null or v_price <= 0 then
    raise exception 'guest_set_cart_item: المتغيّر % غير موجود أو غير قابل للشراء', p_variant_id
      using errcode = '22023';
  end if;

  update public.cart_items
     set quantity = p_quantity, unit_price_fils = v_price
   where cart_id = v_cart and variant_id = p_variant_id;

  if not found then
    insert into public.cart_items (cart_id, variant_id, quantity, unit_price_fils)
    values (v_cart, p_variant_id, p_quantity, v_price);
  end if;

  perform public.guest_touch(v_session);
  return public.guest_get_cart(p_token);
end;
$$;

create or replace function public.guest_clear_cart(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session uuid := public.guest_session_id_for(p_token);
  v_cart    uuid := public.guest_cart_id(v_session);
begin
  delete from public.cart_items where cart_id = v_cart;
  perform public.guest_touch(v_session);
  return jsonb_build_object('cart_id', v_cart, 'items', '[]'::jsonb);
end;
$$;

-- ===========================================================================
-- ٤) طلبات العطر المخصّص
--
-- تُنشأ باسم الجلسة لا باسم صف عميل: الضيف قد يطلب عطراً مخصّصاً قبل أن
-- يُسأل اسمه وهاتفه إطلاقاً. عمود `customer_id` صار قابلاً للـNULL في 0009
-- لهذا السبب بالذات، والقيد `cpr_has_owner` يمنع الصف اليتيم.
--
-- الحالة `'new'` مفروضة: التسعير والقبول والرفض قرار تشغيلي لا خانة يملؤها
-- من يطلب. القاعدة نفسها المفروضة على المجهول في 0006 §٦.
-- ===========================================================================
create or replace function public.guest_create_custom_request(
  p_token        text,
  p_bottle_size  text,
  p_catalog_code text    default null,
  p_free_text    text    default null,
  p_quantity     integer default 1,
  p_notes        text    default null,
  p_add_to_cart  boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session   uuid := public.guest_session_id_for(p_token);
  v_size      text := nullif(btrim(coalesce(p_bottle_size, '')), '');
  v_free      text := nullif(btrim(coalesce(p_free_text, '')), '');
  v_code      text := nullif(btrim(coalesce(p_catalog_code, '')), '');
  v_price     integer;
  v_catalog   uuid;
  v_request   uuid;
  v_cart      uuid;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'guest_create_custom_request: الكمية يجب أن تكون عدداً موجباً'
      using errcode = '22023';
  end if;

  -- السعر من دالة السياسة نفسها التي يستعملها place_order — لا رقم مكرّر.
  v_price := public.custom_price_fils(v_size);
  if v_price is null then
    raise exception 'guest_create_custom_request: المقاس % غير معتمد (المعتمد: 50ml أو 100ml)',
      coalesce(v_size, 'null') using errcode = '22023';
  end if;

  if v_code is not null then
    select id into v_catalog from public.perfume_catalog where code = v_code and is_active;
    if not found then
      raise exception 'guest_create_custom_request: رمز الكتالوج % غير موجود أو غير مفعّل', v_code
        using errcode = '22023';
    end if;
  elsif v_free is null then
    raise exception 'guest_create_custom_request: يلزم catalog_code أو free_text'
      using errcode = '22023';
  end if;

  insert into public.custom_perfume_requests
    (customer_id, guest_session_id, catalog_id, free_text_request, bottle_size,
     quantity, quoted_price_fils, status, customer_notes)
  values
    (null, v_session, v_catalog, v_free, v_size,
     p_quantity, v_price, 'new', nullif(btrim(coalesce(p_notes, '')), ''))
  returning id into v_request;

  if p_add_to_cart then
    v_cart := public.guest_cart_id(v_session);
    insert into public.cart_items (cart_id, custom_request_id, quantity, unit_price_fils)
    values (v_cart, v_request, p_quantity, v_price);
  end if;

  perform public.guest_touch(v_session);

  return jsonb_build_object(
    'request_id',        v_request,
    'bottle_size',       v_size,
    'quantity',          p_quantity,
    'quoted_price_fils', v_price,
    'status',            'new',
    'cart_id',           v_cart
  );
end;
$$;

create or replace function public.guest_list_custom_requests(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session uuid := public.guest_session_id_for(p_token);
  v_out     jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'request_id',        r.id,
           'catalog_code',      c.code,
           'free_text_request', r.free_text_request,
           'bottle_size',       r.bottle_size,
           'quantity',          r.quantity,
           'quoted_price_fils', r.quoted_price_fils,
           'status',            r.status,
           'created_at',        r.created_at
         ) order by r.created_at desc), '[]'::jsonb)
    into v_out
    from public.custom_perfume_requests r
    left join public.perfume_catalog c on c.id = r.catalog_id
   where r.guest_session_id = v_session;

  perform public.guest_touch(v_session);
  return v_out;
end;
$$;

-- ===========================================================================
-- ٥) إنشاء الطلب — نواة مشتركة، ومسارا هوية فوقها
--
-- ما يلي هو جسم `place_order` من 0007 بلا تغيير في المنطق، منقولاً إلى دالة
-- داخلية تستقبل صف العميل محلولاً. المسار الموقّع والمسار الضيف كلاهما
-- يستدعيها. أي تعديل مستقبلي على التسعير أو الطابور أو عدم التكرار يُكتب
-- مرّة واحدة ويسري على المسارين معاً — وهذا هو الغرض كلّه.
-- ===========================================================================
create or replace function public.place_order_core(
  p_customer_id      uuid,
  p_items            jsonb,
  p_customer         jsonb,
  p_idempotency_key  text,
  p_outcome          text,
  p_owner_uid        uuid default null,
  p_guest_session_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key            text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_outcome        text := lower(btrim(coalesce(p_outcome, 'success')));
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

  v_priced         jsonb   := '[]'::jsonb;
  v_priced_item    jsonb;
begin
  if p_customer_id is null then
    raise exception 'place_order_core: صف العميل مطلوب' using errcode = '22023';
  end if;

  if v_outcome not in ('success', 'failed') then
    raise exception 'place_order: p_outcome يجب أن يكون success أو failed (وصل %)', p_outcome
      using errcode = '22023';
  end if;

  if v_key is null then
    raise exception 'place_order: p_idempotency_key مطلوب' using errcode = '22023';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'place_order: p_items يجب أن يكون مصفوفة غير فارغة' using errcode = '22023';
  end if;

  -- عدم التكرار — الفحص المبكر (الحالة الشائعة). الفهرس الفريد يحسم النادرة.
  select * into v_existing
    from public.orders
   where customer_id = p_customer_id and idempotency_key = v_key;

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

  -- التسعير من القاعدة. أي مفتاح سعر في عنصر البند لا يُقرأ في أي سطر مما يلي.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_variant_id := null;
    v_catalog_id := null;
    v_request_id := null;
    v_size       := nullif(btrim(coalesce(v_item ->> 'size', v_item ->> 'bottle_size', '')), '');
    v_free_text  := nullif(btrim(coalesce(v_item ->> 'free_text', v_item ->> 'free_text_request', '')), '');

    begin
      v_qty := (v_item ->> 'quantity')::integer;
    exception when others then
      raise exception 'place_order: كمية غير صالحة في البند %', v_item using errcode = '22023';
    end;
    if v_qty is null or v_qty <= 0 then
      raise exception 'place_order: الكمية يجب أن تكون عدداً صحيحاً موجباً (وصل %)',
        coalesce(v_item ->> 'quantity', 'null') using errcode = '22023';
    end if;

    v_kind := lower(coalesce(nullif(btrim(coalesce(v_item ->> 'kind', '')), ''),
                             case when (v_item ->> 'variant_id') is not null
                                  then 'ready' else 'custom' end));

    if v_kind = 'ready' then
      begin
        v_variant_id := (v_item ->> 'variant_id')::uuid;
      exception when others then
        raise exception 'place_order: variant_id غير صالح في البند %', v_item using errcode = '22023';
      end;

      select v.price_fils,
             coalesce(p.title_ar, p.title_en, v.sku) || ' · ' || v.bottle_size
        into v_unit_fils, v_title
        from public.product_variants v
        join public.products p on p.id = v.product_id
       where v.id = v_variant_id and v.is_active and p.is_available;

      if not found then
        raise exception 'place_order: المتغيّر % غير موجود أو غير متاح للشراء', v_variant_id
          using errcode = '22023';
      end if;

      if v_unit_fils is null or v_unit_fils <= 0 then
        raise exception 'place_order: المتغيّر % غير قابل للشراء (سعر %)',
          v_variant_id, coalesce(v_unit_fils::text, 'null') using errcode = '22023';
      end if;

    elsif v_kind = 'custom' then
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

      -- طلب العطر المخصّص يحمل المحورين: صف العميل (موجود دائماً عند الطلب)
      -- وجلسة الضيف إن كان المستدعي ضيفاً. الثاني هو ما يجعل السياسة
      -- المقيِّدة في 0009 §٤ تحجبه عن كل جلسة عميل.
      insert into public.custom_perfume_requests
        (customer_id, guest_session_id, catalog_id, free_text_request, bottle_size,
         quantity, quoted_price_fils, status, customer_notes)
      values (p_customer_id, p_guest_session_id, v_catalog_id, v_free_text, v_size, v_qty,
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

  -- المجاميع — الحدّ عند ٣ محسوب من مجموع الكميات لا عدد البنود.
  if v_item_count >= public.bulk_threshold_items() then
    v_discount := public.percent_of_fils(v_subtotal, public.bulk_discount_percent());
    v_shipping := 0;
  else
    v_discount := 0;
    v_shipping := public.shipping_flat_fils();
  end if;
  v_total := v_subtotal - v_discount + v_shipping;

  if v_outcome = 'success' then
    v_order_status   := 'paid';  v_payment_status := 'paid';   v_payment_state := 'paid';
  else
    v_order_status   := 'failed'; v_payment_status := 'failed'; v_payment_state := 'failed';
  end if;

  begin
    v_order_number := 'STG-' || nextval('public.order_number_seq')::text;

    insert into public.orders
      (order_number, customer_id, guest_session_id, status, payment_status,
       subtotal_fils, shipping_fils, discount_fils, total_fils,
       shipping_address, idempotency_key)
    values (
      v_order_number, p_customer_id, p_guest_session_id, v_order_status, v_payment_status,
      v_subtotal::integer, v_shipping, v_discount, v_total::integer,
      jsonb_strip_nulls(jsonb_build_object(
        'emirate',  coalesce(nullif(btrim(coalesce(p_customer ->> 'emirate',  '')), ''), (select emirate  from public.customers where id = p_customer_id)),
        'area',     coalesce(nullif(btrim(coalesce(p_customer ->> 'area',     '')), ''), (select area     from public.customers where id = p_customer_id)),
        'street',   coalesce(nullif(btrim(coalesce(p_customer ->> 'street',   '')), ''), (select street   from public.customers where id = p_customer_id)),
        'building', coalesce(nullif(btrim(coalesce(p_customer ->> 'building', '')), ''), (select building from public.customers where id = p_customer_id)),
        'flat',     coalesce(nullif(btrim(coalesce(p_customer ->> 'flat',     '')), ''), (select flat     from public.customers where id = p_customer_id))
      )),
      v_key
    )
    returning id into v_order_id;
  exception when unique_violation then
    select * into v_existing
      from public.orders
     where customer_id = p_customer_id and idempotency_key = v_key;
    if not found then raise; end if;
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

  insert into public.payments (order_id, provider, intent_id, status, amount_fils, raw_response)
  values (
    v_order_id, 'mock', 'stg_' || replace(v_order_id::text, '-', ''),
    v_payment_state, v_total::integer,
    jsonb_build_object('simulated', true, 'outcome', v_outcome, 'environment', 'staging')
  );

  -- طابور الإنتاج للمدفوع وحده. الفحص المسبق مقصود رغم وجود trigger — الشرح
  -- كاملاً في 0007 §٣-ح.
  if v_payment_status = 'paid' then
    insert into public.production_queue (order_id, status) values (v_order_id, 'queued');
  end if;

  -- إغلاق السلة المفتوحة على أيٍّ من المحاور الثلاثة.
  update public.carts
     set status = 'converted', customer_id = coalesce(customer_id, p_customer_id)
   where status = 'open'
     and (   (p_owner_uid        is not null and user_id          = p_owner_uid)
          or (p_guest_session_id is not null and guest_session_id = p_guest_session_id)
          or customer_id = p_customer_id);

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
-- ٥-ب) المسار الموقّع — كما كان، لكن الجسم صار استدعاءً
--
-- السلوك المرئي لم يتغيّر بحرف: الفحوص نفسها بالترتيب نفسه والرسائل نفسها.
-- ما تغيّر أن نصف الجسم انتقل إلى النواة.
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
  v_uid         uuid := auth.uid();
  v_customer_id uuid;
begin
  if v_uid is null then
    raise exception 'place_order: يلزم تسجيل الدخول' using errcode = '42501';
  end if;

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
      select id into v_customer_id from public.customers where user_id = v_uid;
      if v_customer_id is null then
        raise exception 'place_order: رقم الهاتف مستعمل في حساب آخر' using errcode = '23505';
      end if;
    end;
  else
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

  return public.place_order_core(
    v_customer_id, p_items, p_customer, p_idempotency_key, p_outcome, v_uid, null);
end;
$$;

-- ---------------------------------------------------------------------------
-- ٥-ج) المسار الضيف
--
-- الفارق الوحيد عن أعلاه هو حلّ الهوية: الرمز بدل auth.uid()، وصف العميل
-- مربوطاً بـguest_session_id بدل user_id. وسقف محاولات الدفع يُفحص هنا لا في
-- النواة — النواة لا تعرف من يستدعيها، وسقفٌ يُفحص في مكان لا يعرف المحور
-- هو سقف بلا معنى.
-- ---------------------------------------------------------------------------
create or replace function public.guest_place_order(
  p_token           text,
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
  v_session     uuid := public.guest_session_id_for(p_token);
  v_customer_id uuid;
  v_attempts    integer;
  v_result      jsonb;
begin
  -- ٥-ج-١) سقف محاولات الدفع، بنافذة متدحرجة تُعاد تصفيرها عند انتهائها.
  -- `for update` يقفل صف الجلسة، فمحاولتان متزامنتان لا تقرآن العدّاد نفسه.
  select case
           when checkout_window_start + public.guest_checkout_window() <= now() then 0
           else checkout_attempts
         end
    into v_attempts
    from public.guest_sessions where id = v_session for update;

  if v_attempts >= public.guest_checkout_cap() then
    raise exception
      'GUEST_CHECKOUT_RATE_LIMIT: تجاوز سقف محاولات الدفع للجلسة (% لكل %)',
      public.guest_checkout_cap(), public.guest_checkout_window()
      using errcode = '53400';
  end if;

  update public.guest_sessions
     set checkout_attempts     = v_attempts + 1,
         checkout_window_start = case when v_attempts = 0 then now() else checkout_window_start end
   where id = v_session;

  -- ٥-ج-٢) صف العميل الخاص بالجلسة: يوجد أو يُنشأ.
  select id into v_customer_id
    from public.customers where guest_session_id = v_session;

  if v_customer_id is null then
    if nullif(btrim(coalesce(p_customer ->> 'full_name', '')), '') is null
       or nullif(btrim(coalesce(p_customer ->> 'phone', '')), '') is null then
      raise exception 'guest_place_order: أول طلب يحتاج full_name وphone في p_customer'
        using errcode = '22023';
    end if;

    begin
      insert into public.customers
        (guest_session_id, full_name, phone, email, emirate, area, street, building, flat)
      values (
        v_session,
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
      select id into v_customer_id from public.customers where guest_session_id = v_session;
      if v_customer_id is null then
        raise exception 'guest_place_order: رقم الهاتف مستعمل في حساب آخر' using errcode = '23505';
      end if;
    end;
  else
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

  v_result := public.place_order_core(
    v_customer_id, p_items, p_customer, p_idempotency_key, p_outcome, null, v_session);

  perform public.guest_touch(v_session);
  return v_result;
end;
$$;

-- ===========================================================================
-- ٦) قراءة حالة الطلب — محصورة بالجلسة
--
-- `where guest_session_id = v_session` هو كل الحصر. لا وسيط يقبل معرّف طلب
-- من الخارج بلا فلترة، ولو قُبل لصار البحث عن طلب الغير أمراً ممكناً بالتخمين.
-- الوسيط الاختياري هو رقم الطلب، وهو يُضيَّق فوق الحصر لا بدلاً منه.
-- ===========================================================================
create or replace function public.guest_order_status(
  p_token        text,
  p_order_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session uuid := public.guest_session_id_for(p_token);
  v_filter  text := nullif(btrim(coalesce(p_order_number, '')), '');
  v_out     jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'order_id',       o.id,
           'order_number',   o.order_number,
           'status',         o.status,
           'payment_status', o.payment_status,
           'subtotal_fils',  o.subtotal_fils,
           'discount_fils',  o.discount_fils,
           'shipping_fils',  o.shipping_fils,
           'total_fils',     o.total_fils,
           'currency',       o.currency,
           'placed_at',      o.placed_at,
           'items', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'title',           i.title_snapshot,
                      'quantity',        i.quantity,
                      'unit_price_fils', i.unit_price_fils,
                      'line_total_fils', i.line_total_fils
                    ) order by i.created_at), '[]'::jsonb)
               from public.order_items i where i.order_id = o.id
           )
         ) order by o.placed_at desc), '[]'::jsonb)
    into v_out
    from public.orders o
   where o.guest_session_id = v_session
     and (v_filter is null or o.order_number = v_filter);

  perform public.guest_touch(v_session);
  return v_out;
end;
$$;

-- ===========================================================================
-- ٧) الانقضاء والتنظيف
--
-- الانقضاء ليس حدثاً يقع، بل مقارنة تُجرى: `expires_at <= now()` تُفحص في كل
-- تحقّق. فلا حاجة إلى مهمّة مجدولة كي تصير الجلسة منتهيةً — تصير كذلك بمرور
-- الوقت وحده، وهذا أمتن من الاعتماد على مهمّة قد لا تعمل.
--
-- ما يحتاج تشغيلاً هو حذف الصفوف الميتة. وهو يدوي لا مجدول، للسبب نفسه
-- الموثّق في 0008: الحذف لا رجعة فيه، ومهمّة ليلية تعني أن خطأً في شرط
-- الحماية يُكتشف بعد أن يكون قد حذف.
--
-- الحارس: لا تُحذف جلسة لها طلب، أبداً. الشرط مكتوب صراحةً هنا، والقيد
-- orders.guest_session_id ... on delete restrict يقوله ثانيةً في القاعدة —
-- فحتى لو أخطأ الشرط، الحذف يفشل بدل أن يمرّ. الطبقتان مقصودتان.
-- ===========================================================================
create or replace function public.cleanup_guest_sessions(
  p_older_than interval default '30 days',
  p_dry_run    boolean  default true,
  p_limit      integer  default 1000
)
returns table (deleted_session_id uuid, created_at timestamptz, last_seen_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cutoff timestamptz := now() - p_older_than;
begin
  if p_older_than < interval '1 day' then
    raise exception 'cleanup_guest_sessions: عتبة أقصر من يوم مرفوضة (وصل %)', p_older_than
      using errcode = '22023';
  end if;

  create temporary table if not exists _stale_guest (
    id uuid primary key, created_at timestamptz, last_seen_at timestamptz
  ) on commit drop;
  delete from _stale_guest;

  -- المرشّحون: راكدة (لم تُرَ منذ العتبة) أو منقضية أو مُبطلة — وبلا أي طلب.
  insert into _stale_guest (id, created_at, last_seen_at)
  select g.id, g.created_at, g.last_seen_at
    from public.guest_sessions g
   where (g.last_seen_at < v_cutoff or g.expires_at <= now() or g.revoked_at is not null)
     and not exists (select 1 from public.orders o where o.guest_session_id = g.id)
   order by g.last_seen_at
   limit greatest(p_limit, 0);

  if p_dry_run then
    return query select s.id, s.created_at, s.last_seen_at from _stale_guest s order by s.last_seen_at;
    return;
  end if;

  -- الترتيب يتبع القيود: بنود السلة تتبع السلة (cascade)، والسلال وطلبات
  -- العطر المخصّص تتبع الجلسة (cascade)، أمّا صف العميل فمرتبط بـrestrict
  -- فيُحذف صراحةً. وصف العميل هذا لا يمكن أن يكون له طلب — الشرط أعلاه استبعد
  -- كل جلسة لها طلب.
  delete from public.customers where guest_session_id in (select id from _stale_guest);
  delete from public.guest_sessions where id in (select id from _stale_guest);

  -- دلاء الإصدار القديمة: بيانات عدّ لا قيمة لها بعد انتهاء نافذتها.
  delete from public.guest_issue_counters
   where window_start < now() - public.guest_issue_window() * 100;

  return query select s.id, s.created_at, s.last_seen_at from _stale_guest s order by s.last_seen_at;
end;
$$;

-- ===========================================================================
-- ٨) سطح الاستدعاء
--
-- `revoke ... from public, anon` ثم منحٌ صريح. ذكر `anon` بالاسم لازم: للمشروع
-- ALTER DEFAULT PRIVILEGES يمنح EXECUTE لـanon على كل دالة جديدة في public،
-- فالمنح صريح في proacl ولا يسقط بسحب امتياز PUBLIC. (هذا ما أمسكه
-- get_advisors بعد 0006، والدرس مطبَّق هنا مسبقاً.)
--
-- ما يُمنح لـanon: أبواب الضيف السبعة وحدها. التطبيق يستدعيها بالمفتاح العام
-- بلا تسجيل دخول، فهذا هو سطحها الصحيح.
-- ما لا يُمنح لأحد غير service_role: النواة، وحلّ الرمز إلى معرّف جلسة،
-- و«رأيتك»، وثوابت السقوف، ودالة التنظيف. كلها داخليات، وكشفها كنقاط RPC
-- كان سيمنح المستدعي أدوات لا يحتاجها ويمنحه معها أوراكل.
-- ===========================================================================

-- ٨-أ) داخليات: service_role وحده
revoke all on function public.guest_token_hash(text)            from public, anon, authenticated;
revoke all on function public.guest_session_id_for(text)        from public, anon, authenticated;
revoke all on function public.guest_touch(uuid)                 from public, anon, authenticated;
revoke all on function public.guest_cart_id(uuid)               from public, anon, authenticated;
revoke all on function public.place_order_core(uuid, jsonb, jsonb, text, text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.cleanup_guest_sessions(interval, boolean, integer)
  from public, anon, authenticated;

grant execute on function public.guest_token_hash(text)     to service_role;
grant execute on function public.guest_session_id_for(text) to service_role;
grant execute on function public.guest_touch(uuid)          to service_role;
grant execute on function public.guest_cart_id(uuid)        to service_role;
grant execute on function public.place_order_core(uuid, jsonb, jsonb, text, text, uuid, uuid)
  to service_role;
grant execute on function public.cleanup_guest_sessions(interval, boolean, integer)
  to service_role;

-- ٨-ب) أبواب الضيف: anon (وservice_role للأدوات الخادمية)
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.issue_guest_token()',
    'public.guest_revoke_token(text)',
    'public.guest_get_cart(text)',
    'public.guest_set_cart_item(text, uuid, integer)',
    'public.guest_clear_cart(text)',
    'public.guest_create_custom_request(text, text, text, text, integer, text, boolean)',
    'public.guest_list_custom_requests(text)',
    'public.guest_place_order(text, jsonb, jsonb, text, text)',
    'public.guest_order_status(text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to anon, service_role', f);
  end loop;
end $$;

-- ٨-ج) المسار الموقّع كما كان: authenticated وحده، لا anon.
revoke all on function public.place_order(jsonb, jsonb, text, text) from public, anon;
grant execute on function public.place_order(jsonb, jsonb, text, text) to authenticated;

comment on function public.issue_guest_token() is
  'يُنشئ جلسة ضيف ويُعيد الرمز الخام مرّةً واحدة. الرمز ٣٢ بايتاً عشوائية '
  'ولا يُخزَّن؛ المخزَّن هو sha256 منه. محكوم بسقف إصدار عالمي لكل نافذة.';

comment on function public.guest_place_order(text, jsonb, jsonb, text, text) is
  'إنشاء طلب لجلسة ضيف مُتحقَّق منها. يتحقّق من الرمز، ثم من سقف محاولات '
  'الدفع، ثم يستدعي place_order_core — النواة نفسها التي يستدعيها المسار '
  'الموقّع، فلا نسختان من التسعير ولا من عدم التكرار ولا من طابور الإنتاج.';

comment on function public.cleanup_guest_sessions(interval, boolean, integer) is
$c$حذف جلسات الضيوف الميتة (راكدة أو منقضية أو مُبطلة) التي لا طلب لها.
تُشغَّل يدوياً بمفتاح service_role — لا cron. الوضع الافتراضي استعراض لا يحذف.

  select * from public.cleanup_guest_sessions();                  -- استعراض
  select * from public.cleanup_guest_sessions('30 days', false);   -- حذف فعلي

الحارس: لا تُحذف جلسة لها طلب أبداً — شرطاً في الجسم، وقيداً
(orders.guest_session_id ... on delete restrict) في القاعدة.$c$;
