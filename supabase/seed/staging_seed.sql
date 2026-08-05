-- ============================================================================
-- RAZEEN V2 STAGING — supabase/seed/staging_seed.sql
--
-- Fully synthetic. Nothing here is derived from production: no real customer,
-- no real order, no real phone number.
--
--   * every product title carries [STG] so a screenshot cannot be mistaken for
--     the live store
--   * phones are in the 05XXXXXXXX test range
--   * emails are @example.test — a reserved TLD that can never receive mail
--
-- Idempotent: re-running changes nothing. Every insert is ON CONFLICT DO
-- NOTHING against a natural key, and the derived rows are inserted by lookup.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 20 products
-- ---------------------------------------------------------------------------
insert into public.products
  (handle, title_ar, title_en, family, intensity, base_price_fils, is_available, is_vip, aliases)
values
  ('stg-amber-oud',      '[STG] عنبر وعود',      'Amber Oud',      'warm',  3, 28900, true,  false, array['عنبر','عود','amber','oud']),
  ('stg-citrus-dawn',    '[STG] فجر حمضي',       'Citrus Dawn',    'fresh', 1, 24500, true,  false, array['حمضي','ليمون','citrus']),
  ('stg-velvet-rose',    '[STG] ورد مخملي',      'Velvet Rose',    'sweet', 2, 31000, false, false, array['ورد','روز','rose']),
  ('stg-royal-musk',     '[STG] مسك ملكي',       'Royal Musk',     'woody', 2, 35500, true,  true,  array['مسك','musk']),
  ('stg-desert-sand',    '[STG] رمال الصحراء',   'Desert Sand',    'warm',  2, 26500, true,  false, array['رمال','صحراء','sand']),
  ('stg-white-jasmine',  '[STG] ياسمين أبيض',    'White Jasmine',  'sweet', 1, 23000, true,  false, array['ياسمين','jasmine']),
  ('stg-black-agar',     '[STG] عود أسود',       'Black Agar',     'woody', 3, 42000, true,  true,  array['عود','agar']),
  ('stg-sea-breeze',     '[STG] نسيم البحر',     'Sea Breeze',     'fresh', 1, 21500, true,  false, array['بحر','نسيم','breeze']),
  ('stg-saffron-night',  '[STG] ليل الزعفران',   'Saffron Night',  'warm',  3, 39000, true,  false, array['زعفران','saffron']),
  ('stg-green-fig',      '[STG] تين أخضر',       'Green Fig',      'fresh', 2, 25500, true,  false, array['تين','fig']),
  ('stg-golden-honey',   '[STG] عسل ذهبي',       'Golden Honey',   'sweet', 2, 27000, true,  false, array['عسل','honey']),
  ('stg-cedar-smoke',    '[STG] دخان الأرز',     'Cedar Smoke',    'woody', 3, 33500, true,  false, array['أرز','دخان','cedar']),
  ('stg-morning-mint',   '[STG] نعناع الصباح',   'Morning Mint',   'fresh', 1, 19900, true,  false, array['نعناع','mint']),
  ('stg-dark-vanilla',   '[STG] فانيلا داكنة',   'Dark Vanilla',   'sweet', 3, 29900, true,  false, array['فانيلا','vanilla']),
  ('stg-silver-iris',    '[STG] سوسن فضي',       'Silver Iris',    'fresh', 2, 30500, true,  false, array['سوسن','iris']),
  ('stg-spiced-leather', '[STG] جلد متبّل',      'Spiced Leather', 'woody', 3, 41000, true,  true,  array['جلد','leather']),
  ('stg-pink-pepper',    '[STG] فلفل وردي',      'Pink Pepper',    'warm',  2, 24900, true,  false, array['فلفل','pepper']),
  ('stg-oud-royale',     '[STG] عود ملكي',       'Oud Royale',     'woody', 3, 48000, false, true,  array['عود','royale']),
  ('stg-blue-lotus',     '[STG] لوتس أزرق',      'Blue Lotus',     'fresh', 2, 28000, true,  false, array['لوتس','lotus']),
  ('stg-warm-amber',     '[STG] عنبر دافئ',      'Warm Amber',     'warm',  2, 26000, true,  false, array['عنبر','amber'])
on conflict (handle) do nothing;

-- ---------------------------------------------------------------------------
-- Variants: every product in three bottle sizes, priced off the base price.
-- ---------------------------------------------------------------------------
insert into public.product_variants (product_id, sku, bottle_size, price_fils, stock_qty, is_active)
select p.id,
       p.handle || '-' || s.size,
       s.size,
       (p.base_price_fils * s.factor)::integer,
       s.stock,
       p.is_available
from public.products p
cross join (values
  ('50ml',  0.65, 12),
  ('100ml', 1.00,  8),
  ('200ml', 1.70,  3)
) as s(size, factor, stock)
where p.handle like 'stg-%'
on conflict (sku) do nothing;

-- ---------------------------------------------------------------------------
-- perfume_catalog — oils for the custom perfume path
-- ---------------------------------------------------------------------------
insert into public.perfume_catalog (code, inspired_brand, perfume_name, kilo_price_fils, is_active, aliases)
values
  ('STG-001', '[STG] BRAND ALPHA',   'MIDNIGHT FIG',   90000,  true,  array['تين','fig']),
  ('STG-002', '[STG] BRAND BETA',    'SAFFRON SMOKE',  140000, true,  array['زعفران','saffron']),
  ('STG-003', '[STG] BRAND GAMMA',   'WHITE AMBER',    62000,  true,  array['عنبر','amber']),
  ('STG-004', '[STG] BRAND DELTA',   'CEDAR ROOM',     78000,  true,  array['أرز','cedar']),
  ('STG-005', '[STG] BRAND EPSILON', 'ROSE VELOURS',   115000, true,  array['ورد','rose']),
  ('STG-006', '[STG] BRAND ZETA',    'CITRUS MARINE',  54000,  true,  array['حمضي','citrus']),
  ('STG-007', '[STG] BRAND ETA',     'LEATHER BERRY',  132000, true,  array['جلد','leather']),
  ('STG-008', '[STG] BRAND THETA',   'MUSK BLANC',     69000,  false, array['مسك','musk'])
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 3 test customers + 1 test admin. Fixed uuids so the RLS suite can address
-- them, and so a re-run does not create duplicates.
-- ---------------------------------------------------------------------------
insert into public.customers (id, user_id, full_name, phone, email, emirate, area, street, building, flat)
values
  ('11111111-1111-4111-8111-111111111111',
   'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
   'نورة التجريبية', '0500000001', 'noura@example.test',
   'دبي', 'منطقة تجريبية', 'شارع الاختبار', 'مبنى ١', '١٠١'),
  ('22222222-2222-4222-8222-222222222222',
   'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
   'سالم التجريبي', '0500000002', 'salem@example.test',
   'أبوظبي', 'منطقة تجريبية ٢', 'شارع الاختبار ٢', 'مبنى ٢', '٢٠٢'),
  ('33333333-3333-4333-8333-333333333333',
   'cccccccc-3333-4333-8333-cccccccccccc',
   'مريم التجريبية', '0500000003', 'maryam@example.test',
   'الشارقة', 'منطقة تجريبية ٣', 'شارع الاختبار ٣', 'مبنى ٣', '٣٠٣')
on conflict (id) do nothing;

insert into public.admin_users (id, user_id, email, role, is_active)
values
  ('44444444-4444-4444-8444-444444444444',
   'dddddddd-4444-4444-8444-dddddddddddd',
   'admin@example.test', 'owner', true)
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Custom perfume requests
-- ---------------------------------------------------------------------------
insert into public.custom_perfume_requests
  (id, customer_id, catalog_id, free_text_request, bottle_size, quantity, quoted_price_fils, status, customer_notes)
select '55555555-5555-4555-8555-555555555555',
       '11111111-1111-4111-8111-111111111111',
       c.id, null, '100ml', 1, 30000, 'accepted', 'ملاحظة تجريبية'
from public.perfume_catalog c where c.code = 'STG-001'
on conflict (id) do nothing;

insert into public.custom_perfume_requests
  (id, customer_id, catalog_id, free_text_request, bottle_size, quantity, quoted_price_fils, status)
values ('66666666-6666-4666-8666-666666666666',
        '22222222-2222-4222-8222-222222222222',
        null, 'عطر تجريبي غير موجود في الكتالوج', '50ml', 1, 24000, 'new')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Orders in different states
--   STG-1001 · نورة   · paid + in_production  → has a production_queue row
--   STG-1002 · سالم   · unpaid + pending
--   STG-1003 · نورة   · paid + delivered      → has a shipment
-- ---------------------------------------------------------------------------
insert into public.orders
  (id, order_number, customer_id, status, payment_status,
   subtotal_fils, shipping_fils, discount_fils, total_fils, shipping_address)
values
  ('a0000000-0000-4000-8000-000000000001', 'STG-1001',
   '11111111-1111-4111-8111-111111111111', 'in_production', 'paid',
   28900, 2500, 0, 31400,
   '{"emirate":"دبي","area":"منطقة تجريبية","street":"شارع الاختبار","building":"مبنى ١","flat":"١٠١"}'::jsonb),
  ('a0000000-0000-4000-8000-000000000002', 'STG-1002',
   '22222222-2222-4222-8222-222222222222', 'pending', 'unpaid',
   24500, 2500, 0, 27000,
   '{"emirate":"أبوظبي","area":"منطقة تجريبية ٢","street":"شارع الاختبار ٢","building":"مبنى ٢","flat":"٢٠٢"}'::jsonb),
  ('a0000000-0000-4000-8000-000000000003', 'STG-1003',
   '11111111-1111-4111-8111-111111111111', 'delivered', 'paid',
   35500, 2500, 0, 38000,
   '{"emirate":"دبي","area":"منطقة تجريبية","street":"شارع الاختبار","building":"مبنى ١","flat":"١٠١"}'::jsonb)
on conflict (order_number) do nothing;

insert into public.order_items
  (id, order_id, variant_id, title_snapshot, quantity, unit_price_fils, line_total_fils)
select 'b0000000-0000-4000-8000-000000000001',
       'a0000000-0000-4000-8000-000000000001',
       v.id, '[STG] عنبر وعود · 100ml', 1, 28900, 28900
from public.product_variants v where v.sku = 'stg-amber-oud-100ml'
on conflict (id) do nothing;

insert into public.order_items
  (id, order_id, variant_id, title_snapshot, quantity, unit_price_fils, line_total_fils)
select 'b0000000-0000-4000-8000-000000000002',
       'a0000000-0000-4000-8000-000000000002',
       v.id, '[STG] فجر حمضي · 100ml', 1, 24500, 24500
from public.product_variants v where v.sku = 'stg-citrus-dawn-100ml'
on conflict (id) do nothing;

insert into public.order_items
  (id, order_id, variant_id, title_snapshot, quantity, unit_price_fils, line_total_fils)
select 'b0000000-0000-4000-8000-000000000003',
       'a0000000-0000-4000-8000-000000000003',
       v.id, '[STG] مسك ملكي · 100ml', 1, 35500, 35500
from public.product_variants v where v.sku = 'stg-royal-musk-100ml'
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Payments (mock provider — no money moves in staging)
-- ---------------------------------------------------------------------------
insert into public.payments (id, order_id, provider, intent_id, status, amount_fils)
values
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'mock', 'stg_intent_0001', 'paid', 31400),
  ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002',
   'mock', 'stg_intent_0002', 'pending', 27000),
  ('c0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003',
   'mock', 'stg_intent_0003', 'paid', 38000)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Production queue — paid orders only (enforced by trigger)
-- ---------------------------------------------------------------------------
insert into public.production_queue (id, order_id, status, production_week, notes)
values ('d0000000-0000-4000-8000-000000000001',
        'a0000000-0000-4000-8000-000000000001', 'mixing', '2026-W32', 'دفعة تجريبية')
on conflict (order_id) do nothing;

-- ---------------------------------------------------------------------------
-- Shipments
-- ---------------------------------------------------------------------------
insert into public.shipments
  (id, order_id, carrier, tracking_number, status, promised_at, shipped_at, delivered_at)
values
  ('e0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003',
   'mock', 'STG-TRK-0003', 'delivered',
   now() - interval '5 days', now() - interval '4 days', now() - interval '2 days')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Cart for نورة, so the ownership policies have something to protect
-- ---------------------------------------------------------------------------
insert into public.carts (id, customer_id, status)
values ('f0000000-0000-4000-8000-000000000001',
        '11111111-1111-4111-8111-111111111111', 'open')
on conflict (id) do nothing;

insert into public.cart_items (id, cart_id, variant_id, quantity, unit_price_fils)
select 'f1000000-0000-4000-8000-000000000001',
       'f0000000-0000-4000-8000-000000000001',
       v.id, 1, 26500
from public.product_variants v where v.sku = 'stg-desert-sand-100ml'
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Outbox — proof that staging records instead of sending
-- ---------------------------------------------------------------------------
insert into public.staging_outbox
  (id, channel, recipient, subject, body, related_entity, related_entity_id)
values
  ('e1000000-0000-4000-8000-000000000001', 'whatsapp', '0500000001', null,
   'كان سيُرسَل: تم استلام طلبك STG-1001 (لم يُرسل — بيئة تجريبية)',
   'orders', 'a0000000-0000-4000-8000-000000000001'),
  ('e1000000-0000-4000-8000-000000000002', 'email', 'noura@example.test',
   'تحديث طلبك',
   'كان سيُرسَل: طلبك STG-1003 وصل (لم يُرسل — بيئة تجريبية)',
   'orders', 'a0000000-0000-4000-8000-000000000003')
on conflict (id) do nothing;
