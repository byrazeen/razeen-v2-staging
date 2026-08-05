-- ============================================================================
-- RAZEEN V2 STAGING — 0002_rls.sql
--
-- Row Level Security for all 16 tables. No table is left open.
--
-- Three actors:
--   anon           — a visitor. May read the shelf. Nothing else.
--   authenticated  — a signed-in customer. May read and write ONLY their own
--                    rows, and may never touch money, stock, production or
--                    shipping state.
--   service_role   — the trusted server. Supabase grants it BYPASSRLS, so no
--                    policy below applies to it. That is deliberate: payment
--                    confirmation, stock movement and messaging are server
--                    concerns, never client ones.
--
-- Ownership is resolved through SECURITY DEFINER helpers rather than inline
-- subqueries. Two reasons: a policy on admin_users that queries admin_users
-- recurses infinitely, and an inline subquery is itself subject to the other
-- table's RLS, which makes a policy's meaning depend on a second policy.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Is the caller an active admin? Reads admin_users with the definer's rights,
-- which is what makes it safe to call from admin_users' OWN policy.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.admin_users a
    where a.user_id = auth.uid() and a.is_active
  );
$$;

-- The customers.id belonging to the caller, or null.
create or replace function public.current_customer_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id from public.customers c where c.user_id = auth.uid();
$$;

create or replace function public.owns_cart(p_cart_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.carts c
    where c.id = p_cart_id
      and c.customer_id is not null
      and c.customer_id = public.current_customer_id()
  );
$$;

create or replace function public.owns_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.orders o
    where o.id = p_order_id
      and o.customer_id = public.current_customer_id()
  );
$$;

create or replace function public.owns_custom_request(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.custom_perfume_requests r
    where r.id = p_request_id
      and r.customer_id = public.current_customer_id()
  );
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.current_customer_id() from public;
revoke all on function public.owns_cart(uuid) from public;
revoke all on function public.owns_order(uuid) from public;
revoke all on function public.owns_custom_request(uuid) from public;
grant execute on function public.is_admin() to anon, authenticated, service_role;
grant execute on function public.current_customer_id() to anon, authenticated, service_role;
grant execute on function public.owns_cart(uuid) to anon, authenticated, service_role;
grant execute on function public.owns_order(uuid) to anon, authenticated, service_role;
grant execute on function public.owns_custom_request(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Table privileges. RLS narrows a grant; it cannot widen one. Both layers are
-- set explicitly so a future GRANT cannot silently open a table.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

grant select on public.products, public.product_variants, public.perfume_catalog
  to anon, authenticated;

grant select, insert, update, delete
  on public.carts, public.cart_items, public.custom_perfume_requests
  to authenticated;
grant select, insert, update on public.customers to authenticated;
grant select, insert on public.orders, public.order_items to authenticated;
grant select on public.payments, public.shipments to authenticated;

-- Admin surfaces: the grant exists so an admin can work; RLS is what limits it
-- to admins. Non-admin authenticated users are stopped by policy, and anon has
-- no grant at all.
grant select, insert, update, delete on
  public.products, public.product_variants, public.perfume_catalog,
  public.customers, public.orders, public.order_items, public.payments,
  public.inventory_movements, public.production_queue, public.shipments,
  public.admin_users, public.audit_logs, public.staging_outbox
  to authenticated;

grant all on all tables in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Enable RLS on all 16 tables. No exceptions. The table owner and service_role
-- are exempt by design (BYPASSRLS); every client-facing role is not.
-- ---------------------------------------------------------------------------
alter table public.products                enable row level security;
alter table public.product_variants        enable row level security;
alter table public.perfume_catalog         enable row level security;
alter table public.custom_perfume_requests enable row level security;
alter table public.customers               enable row level security;
alter table public.carts                   enable row level security;
alter table public.cart_items              enable row level security;
alter table public.orders                  enable row level security;
alter table public.order_items             enable row level security;
alter table public.payments                enable row level security;
alter table public.inventory_movements     enable row level security;
alter table public.production_queue        enable row level security;
alter table public.shipments               enable row level security;
alter table public.admin_users             enable row level security;
alter table public.audit_logs              enable row level security;
alter table public.staging_outbox          enable row level security;

-- ===========================================================================
-- PUBLIC SHELF — readable by everyone, writable by admins only
-- ===========================================================================
drop policy if exists products_read_all on public.products;
create policy products_read_all on public.products
  for select to anon, authenticated using (true);
drop policy if exists products_admin_write on public.products;
create policy products_admin_write on public.products
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists variants_read_all on public.product_variants;
create policy variants_read_all on public.product_variants
  for select to anon, authenticated using (true);
drop policy if exists variants_admin_write on public.product_variants;
create policy variants_admin_write on public.product_variants
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists catalog_read_all on public.perfume_catalog;
create policy catalog_read_all on public.perfume_catalog
  for select to anon, authenticated using (true);
drop policy if exists catalog_admin_write on public.perfume_catalog;
create policy catalog_admin_write on public.perfume_catalog
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ===========================================================================
-- customers — own row only. anon has no policy and no grant: it cannot read.
-- ===========================================================================
drop policy if exists customers_select_own on public.customers;
create policy customers_select_own on public.customers
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists customers_insert_own on public.customers;
create policy customers_insert_own on public.customers
  for insert to authenticated
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists customers_update_own on public.customers;
create policy customers_update_own on public.customers
  for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists customers_delete_admin on public.customers;
create policy customers_delete_admin on public.customers
  for delete to authenticated using (public.is_admin());

-- ===========================================================================
-- carts / cart_items — own only
-- ===========================================================================
drop policy if exists carts_own on public.carts;
create policy carts_own on public.carts
  for all to authenticated
  using (customer_id = public.current_customer_id() or public.is_admin())
  with check (customer_id = public.current_customer_id() or public.is_admin());

drop policy if exists cart_items_own on public.cart_items;
create policy cart_items_own on public.cart_items
  for all to authenticated
  using (public.owns_cart(cart_id) or public.is_admin())
  with check (public.owns_cart(cart_id) or public.is_admin());

-- ===========================================================================
-- custom_perfume_requests — own only
-- ===========================================================================
drop policy if exists cpr_own on public.custom_perfume_requests;
create policy cpr_own on public.custom_perfume_requests
  for all to authenticated
  using (customer_id = public.current_customer_id() or public.is_admin())
  with check (customer_id = public.current_customer_id() or public.is_admin());

-- ===========================================================================
-- orders — a customer sees and places their own; only an admin moves a status.
-- The customer's UPDATE is intentionally absent, so status and payment_status
-- are unreachable from a client session.
-- ===========================================================================
drop policy if exists orders_select_own on public.orders;
create policy orders_select_own on public.orders
  for select to authenticated
  using (customer_id = public.current_customer_id() or public.is_admin());

drop policy if exists orders_insert_own on public.orders;
create policy orders_insert_own on public.orders
  for insert to authenticated
  with check (
    (customer_id = public.current_customer_id()
     and status = 'pending' and payment_status = 'unpaid')
    or public.is_admin()
  );

drop policy if exists orders_update_admin on public.orders;
create policy orders_update_admin on public.orders
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists orders_delete_admin on public.orders;
create policy orders_delete_admin on public.orders
  for delete to authenticated using (public.is_admin());

-- ===========================================================================
-- order_items — visible with the order, added with the order, never edited
-- ===========================================================================
drop policy if exists order_items_select_own on public.order_items;
create policy order_items_select_own on public.order_items
  for select to authenticated
  using (public.owns_order(order_id) or public.is_admin());

drop policy if exists order_items_insert_own on public.order_items;
create policy order_items_insert_own on public.order_items
  for insert to authenticated
  with check (public.owns_order(order_id) or public.is_admin());

drop policy if exists order_items_update_admin on public.order_items;
create policy order_items_update_admin on public.order_items
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists order_items_delete_admin on public.order_items;
create policy order_items_delete_admin on public.order_items
  for delete to authenticated using (public.is_admin());

-- ===========================================================================
-- payments — a customer may look at their own payment and may never write one.
-- Payment status is decided by the payment adapter under the service role.
-- ===========================================================================
drop policy if exists payments_select_own on public.payments;
create policy payments_select_own on public.payments
  for select to authenticated
  using (public.owns_order(order_id) or public.is_admin());

drop policy if exists payments_admin_write on public.payments;
create policy payments_admin_write on public.payments
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ===========================================================================
-- inventory_movements — admin only, in both directions
-- ===========================================================================
drop policy if exists inventory_admin_all on public.inventory_movements;
create policy inventory_admin_all on public.inventory_movements
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ===========================================================================
-- production_queue — operations surface, admin only
-- ===========================================================================
drop policy if exists production_queue_admin_all on public.production_queue;
create policy production_queue_admin_all on public.production_queue
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ===========================================================================
-- shipments — a customer may track their own; only an admin changes one
-- ===========================================================================
drop policy if exists shipments_select_own on public.shipments;
create policy shipments_select_own on public.shipments
  for select to authenticated
  using (public.owns_order(order_id) or public.is_admin());

drop policy if exists shipments_admin_write on public.shipments;
create policy shipments_admin_write on public.shipments
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ===========================================================================
-- admin_users — admin only. is_admin() is SECURITY DEFINER, so this policy
-- does not re-enter admin_users' own RLS and does not recurse.
-- ===========================================================================
drop policy if exists admin_users_admin_all on public.admin_users;
create policy admin_users_admin_all on public.admin_users
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ===========================================================================
-- audit_logs — admins read. Nobody writes through a client session; the audit
-- triggers in 0003 are SECURITY DEFINER and insert on the caller's behalf.
-- ===========================================================================
drop policy if exists audit_logs_admin_read on public.audit_logs;
create policy audit_logs_admin_read on public.audit_logs
  for select to authenticated using (public.is_admin());

-- ===========================================================================
-- staging_outbox — admin read-only surface. Rows are written by the mock
-- adapters under the service role. Nothing here is ever delivered.
-- ===========================================================================
drop policy if exists outbox_admin_read on public.staging_outbox;
create policy outbox_admin_read on public.staging_outbox
  for select to authenticated using (public.is_admin());
