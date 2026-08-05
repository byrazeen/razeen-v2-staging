-- ============================================================================
-- RAZEEN V2 STAGING — 0001_baseline.sql
--
-- A clean schema written from the V2 blueprint, NOT copied from production.
-- Production's 206 migrations carry a decade of contradictions (two pricing
-- formulas, five status systems, five permission systems). None of that is
-- reproduced here.
--
-- This file creates 16 tables, their constraints and their indexes. RLS is a
-- separate concern and lives in 0002_rls.sql; auditing lives in 0003_audit.sql.
--
-- Conventions:
--   * every id is uuid primary key default gen_random_uuid()
--   * every timestamp is timestamptz default now()
--   * every foreign key has an index (Postgres does not create one)
--   * every enumerable column is a CHECK, not a pg enum — a CHECK can be
--     altered in one statement, an enum cannot
--   * money is stored in fils (integer), never float. 100 fils = 1 AED.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- updated_at trigger, shared by every table that has the column
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ===========================================================================
-- 1. products — the ready-made shelf
-- ===========================================================================
create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  handle        text not null unique,
  title_ar      text not null,
  title_en      text,
  description_ar text,
  family        text check (family in ('warm','fresh','sweet','woody')),
  intensity     smallint check (intensity between 1 and 3),
  base_price_fils integer not null check (base_price_fils >= 0),
  currency      text not null default 'AED' check (currency = 'AED'),
  is_available  boolean not null default true,
  is_vip        boolean not null default false,
  aliases       text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_products_available on public.products (is_available);
create index if not exists idx_products_family    on public.products (family);
create index if not exists idx_products_handle    on public.products (handle);

create or replace trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 2. product_variants — a product is bought in a bottle size
-- ===========================================================================
create table if not exists public.product_variants (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  sku         text not null unique,
  bottle_size text not null check (bottle_size in ('50ml','100ml','200ml')),
  price_fils  integer not null check (price_fils >= 0),
  stock_qty   integer not null default 0 check (stock_qty >= 0),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (product_id, bottle_size)
);
create index if not exists idx_variants_product on public.product_variants (product_id);
create index if not exists idx_variants_active  on public.product_variants (is_active);
create index if not exists idx_variants_sku     on public.product_variants (sku);

create or replace trigger trg_variants_updated_at
  before update on public.product_variants
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 3. perfume_catalog — the oils a custom perfume can be built from
-- ===========================================================================
create table if not exists public.perfume_catalog (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  inspired_brand  text not null,
  perfume_name    text not null,
  kilo_price_fils integer not null check (kilo_price_fils > 0),
  is_active       boolean not null default true,
  aliases         text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_catalog_active on public.perfume_catalog (is_active);
create index if not exists idx_catalog_brand  on public.perfume_catalog (inspired_brand);
create index if not exists idx_catalog_code   on public.perfume_catalog (code);

create or replace trigger trg_catalog_updated_at
  before update on public.perfume_catalog
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 4. customers — links to auth.users via user_id
-- ===========================================================================
create table if not exists public.customers (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid unique,                    -- references auth.users(id)
  full_name   text not null,
  phone       text not null unique check (phone ~ '^05[0-9]{8}$'),
  email       text check (email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  emirate     text,
  area        text,
  street      text,
  building    text,
  flat        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_customers_user_id on public.customers (user_id);
create index if not exists idx_customers_phone   on public.customers (phone);
create index if not exists idx_customers_email   on public.customers (email);

create or replace trigger trg_customers_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 5. custom_perfume_requests — including "I could not find my perfume"
-- ===========================================================================
create table if not exists public.custom_perfume_requests (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        uuid not null references public.customers (id) on delete cascade,
  catalog_id         uuid references public.perfume_catalog (id) on delete set null,
  free_text_request  text,
  bottle_size        text not null check (bottle_size in ('50ml','100ml','200ml')),
  quantity           integer not null default 1 check (quantity > 0),
  quoted_price_fils  integer not null check (quoted_price_fils >= 0),
  status             text not null default 'new'
                     check (status in ('new','quoted','accepted','rejected','converted')),
  customer_notes     text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- either a catalogue oil or a written request, never neither
  constraint custom_request_has_subject
    check (catalog_id is not null or nullif(btrim(coalesce(free_text_request,'')),'') is not null)
);
create index if not exists idx_cpr_customer on public.custom_perfume_requests (customer_id);
create index if not exists idx_cpr_catalog  on public.custom_perfume_requests (catalog_id);
create index if not exists idx_cpr_status   on public.custom_perfume_requests (status);

create or replace trigger trg_cpr_updated_at
  before update on public.custom_perfume_requests
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 6. carts — one open cart per customer; guests get a session_token
-- ===========================================================================
create table if not exists public.carts (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid references public.customers (id) on delete cascade,
  session_token text,
  status        text not null default 'open' check (status in ('open','converted','abandoned')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint cart_has_owner check (customer_id is not null or session_token is not null)
);
create index if not exists idx_carts_customer on public.carts (customer_id);
create index if not exists idx_carts_status   on public.carts (status);
create index if not exists idx_carts_session  on public.carts (session_token);
create unique index if not exists uq_open_cart_per_customer
  on public.carts (customer_id) where status = 'open' and customer_id is not null;

create or replace trigger trg_carts_updated_at
  before update on public.carts
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 7. cart_items — a ready product variant OR a custom request, never both
-- ===========================================================================
create table if not exists public.cart_items (
  id                 uuid primary key default gen_random_uuid(),
  cart_id            uuid not null references public.carts (id) on delete cascade,
  variant_id         uuid references public.product_variants (id) on delete restrict,
  custom_request_id  uuid references public.custom_perfume_requests (id) on delete cascade,
  quantity           integer not null default 1 check (quantity > 0),
  unit_price_fils    integer not null check (unit_price_fils >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint cart_item_is_one_thing check (
    (variant_id is not null and custom_request_id is null)
    or (variant_id is null and custom_request_id is not null)
  )
);
create index if not exists idx_cart_items_cart    on public.cart_items (cart_id);
create index if not exists idx_cart_items_variant on public.cart_items (variant_id);
create index if not exists idx_cart_items_custom  on public.cart_items (custom_request_id);

create or replace trigger trg_cart_items_updated_at
  before update on public.cart_items
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 8. orders — one status system, and a payment status kept separate from it
-- ===========================================================================
create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  order_number    text not null unique,
  customer_id     uuid not null references public.customers (id) on delete restrict,
  status          text not null default 'pending' check (status in (
                    'pending','paid','failed','cancelled',
                    'in_production','ready','shipped','delivered')),
  payment_status  text not null default 'unpaid' check (payment_status in (
                    'unpaid','authorized','paid','refunded','failed')),
  subtotal_fils   integer not null default 0 check (subtotal_fils >= 0),
  shipping_fils   integer not null default 0 check (shipping_fils >= 0),
  discount_fils   integer not null default 0 check (discount_fils >= 0),
  total_fils      integer not null default 0 check (total_fils >= 0),
  currency        text not null default 'AED' check (currency = 'AED'),
  shipping_address jsonb not null default '{}'::jsonb,
  placed_at       timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_orders_customer    on public.orders (customer_id);
create index if not exists idx_orders_status      on public.orders (status);
create index if not exists idx_orders_pay_status  on public.orders (payment_status);
create index if not exists idx_orders_number      on public.orders (order_number);
create index if not exists idx_orders_placed_at   on public.orders (placed_at desc);

create or replace trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 9. order_items — priced at the moment of sale, never recomputed
-- ===========================================================================
create table if not exists public.order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders (id) on delete cascade,
  variant_id        uuid references public.product_variants (id) on delete set null,
  custom_request_id uuid references public.custom_perfume_requests (id) on delete set null,
  title_snapshot    text not null,
  quantity          integer not null check (quantity > 0),
  unit_price_fils   integer not null check (unit_price_fils >= 0),
  line_total_fils   integer not null check (line_total_fils >= 0),
  created_at        timestamptz not null default now(),
  constraint order_item_is_one_thing check (
    (variant_id is not null and custom_request_id is null)
    or (variant_id is null and custom_request_id is not null)
  )
);
create index if not exists idx_order_items_order   on public.order_items (order_id);
create index if not exists idx_order_items_variant on public.order_items (variant_id);
create index if not exists idx_order_items_custom  on public.order_items (custom_request_id);

-- ===========================================================================
-- 10. payments — written by the payment adapter (service role) only
-- ===========================================================================
create table if not exists public.payments (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders (id) on delete cascade,
  provider      text not null default 'mock' check (provider in ('mock','sandbox')),
  intent_id     text,
  status        text not null default 'pending'
                check (status in ('pending','authorized','paid','failed','refunded')),
  amount_fils   integer not null check (amount_fils >= 0),
  currency      text not null default 'AED' check (currency = 'AED'),
  raw_response  jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_payments_order  on public.payments (order_id);
create index if not exists idx_payments_status on public.payments (status);
create index if not exists idx_payments_intent on public.payments (intent_id);

create or replace trigger trg_payments_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 11. inventory_movements — append-only stock ledger
-- ===========================================================================
create table if not exists public.inventory_movements (
  id          uuid primary key default gen_random_uuid(),
  variant_id  uuid not null references public.product_variants (id) on delete cascade,
  order_id    uuid references public.orders (id) on delete set null,
  delta_qty   integer not null check (delta_qty <> 0),
  reason      text not null check (reason in ('purchase','sale','return','adjustment','damage')),
  note        text,
  created_by  uuid,                            -- auth.users(id) of the acting admin
  created_at  timestamptz not null default now()
);
create index if not exists idx_inv_variant on public.inventory_movements (variant_id);
create index if not exists idx_inv_order   on public.inventory_movements (order_id);
create index if not exists idx_inv_reason  on public.inventory_movements (reason);
create index if not exists idx_inv_created on public.inventory_movements (created_at desc);

-- ===========================================================================
-- 12. production_queue — PAID orders only. The old system showed the unpaid
--     and hid the paid; the constraint below makes that impossible.
-- ===========================================================================
create table if not exists public.production_queue (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null unique references public.orders (id) on delete cascade,
  status         text not null default 'queued'
                 check (status in ('queued','mixing','bottling','done','on_hold')),
  production_week text,
  assigned_to    uuid,                          -- auth.users(id) of the assignee
  notes          text,
  entered_at     timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_pq_order  on public.production_queue (order_id);
create index if not exists idx_pq_status on public.production_queue (status);
create index if not exists idx_pq_week   on public.production_queue (production_week);

create or replace trigger trg_pq_updated_at
  before update on public.production_queue
  for each row execute function public.set_updated_at();

-- Enforce "paid orders only" at write time.
create or replace function public.production_queue_requires_paid_order()
returns trigger
language plpgsql
as $$
declare
  v_payment_status text;
begin
  select payment_status into v_payment_status
    from public.orders where id = new.order_id;
  if v_payment_status is distinct from 'paid' then
    raise exception 'production_queue accepts paid orders only (order % is %)',
      new.order_id, coalesce(v_payment_status, 'missing');
  end if;
  return new;
end;
$$;

create or replace trigger trg_pq_requires_paid
  before insert or update of order_id on public.production_queue
  for each row execute function public.production_queue_requires_paid_order();

-- ===========================================================================
-- 13. shipments — one delivery promise per order
-- ===========================================================================
create table if not exists public.shipments (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders (id) on delete cascade,
  carrier         text not null default 'mock',
  tracking_number text unique,
  status          text not null default 'pending'
                  check (status in ('pending','picked_up','in_transit','delivered','returned','failed')),
  promised_at     timestamptz,
  shipped_at      timestamptz,
  delivered_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_shipments_order    on public.shipments (order_id);
create index if not exists idx_shipments_status   on public.shipments (status);
create index if not exists idx_shipments_tracking on public.shipments (tracking_number);

create or replace trigger trg_shipments_updated_at
  before update on public.shipments
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 14. admin_users — the single permission system
-- ===========================================================================
create table if not exists public.admin_users (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique,             -- auth.users(id)
  email      text not null unique check (email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  role       text not null default 'staff' check (role in ('owner','admin','staff')),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_admin_users_user_id on public.admin_users (user_id);
create index if not exists idx_admin_users_active  on public.admin_users (is_active);
create index if not exists idx_admin_users_role    on public.admin_users (role);

create or replace trigger trg_admin_users_updated_at
  before update on public.admin_users
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 15. audit_logs — who changed what, before and after
-- ===========================================================================
create table if not exists public.audit_logs (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid,                              -- auth.users(id), null for system
  actor_role text,
  action     text not null check (action in ('insert','update','delete')),
  entity     text not null,
  entity_id  uuid,
  before     jsonb,
  after      jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_actor   on public.audit_logs (actor_id);
create index if not exists idx_audit_entity  on public.audit_logs (entity, entity_id);
create index if not exists idx_audit_created on public.audit_logs (created_at desc);

-- ===========================================================================
-- 16. staging_outbox — messages the system WOULD have sent, and never sends.
--     There is no sender in staging. This table is the whole delivery layer.
-- ===========================================================================
create table if not exists public.staging_outbox (
  id                 uuid primary key default gen_random_uuid(),
  channel            text not null check (channel in ('whatsapp','sms','email','push')),
  recipient          text not null,
  subject            text,
  body               text not null,
  related_entity     text,
  related_entity_id  uuid,
  would_have_sent_at timestamptz not null default now(),
  created_at         timestamptz not null default now()
);
create index if not exists idx_outbox_channel on public.staging_outbox (channel);
create index if not exists idx_outbox_related on public.staging_outbox (related_entity, related_entity_id);
create index if not exists idx_outbox_when    on public.staging_outbox (would_have_sent_at desc);

comment on table public.staging_outbox is
  'Staging only. Records what would have been sent. Nothing here is ever delivered.';
