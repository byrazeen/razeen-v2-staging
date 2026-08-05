-- ============================================================================
-- RAZEEN V2 STAGING — 0003_audit.sql
--
-- Every meaningful operational mutation leaves a row in audit_logs: who, what,
-- which entity, and the before/after of the columns that matter.
--
-- The trigger function is SECURITY DEFINER so it can insert into audit_logs
-- even though no role has an INSERT policy there. That is the point: an audit
-- row must be un-writable by hand and un-suppressable by the actor.
--
-- Audited:
--   orders.status              order lifecycle moved
--   orders.payment_status      money state changed
--   payments.status            provider outcome recorded
--   inventory_movements        stock ledger appended (insert is the event)
--   production_queue.status    production state moved
--   shipments.status           delivery state moved
-- ============================================================================

create or replace function public.write_audit_log(
  p_action    text,
  p_entity    text,
  p_entity_id uuid,
  p_before    jsonb,
  p_after     jsonb
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.audit_logs (actor_id, actor_role, action, entity, entity_id, before, after)
  values (auth.uid(), current_setting('role', true), p_action, p_entity, p_entity_id, p_before, p_after);
end;
$$;

revoke all on function public.write_audit_log(text, text, uuid, jsonb, jsonb) from public;

-- ---------------------------------------------------------------------------
-- Generic status auditor.
--
-- Trigger arguments: TG_ARGV[0..] = the column names to watch. A row is written
-- only when one of those columns actually changed, so an UPDATE that touches
-- nothing meaningful does not inflate the log.
-- ---------------------------------------------------------------------------
create or replace function public.audit_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_col      text;
  v_old      jsonb := to_jsonb(old);
  v_new      jsonb := to_jsonb(new);
  v_before   jsonb := '{}'::jsonb;
  v_after    jsonb := '{}'::jsonb;
  v_changed  boolean := false;
begin
  foreach v_col in array tg_argv loop
    if v_old -> v_col is distinct from v_new -> v_col then
      v_changed := true;
      v_before  := v_before || jsonb_build_object(v_col, v_old -> v_col);
      v_after   := v_after  || jsonb_build_object(v_col, v_new -> v_col);
    end if;
  end loop;

  if v_changed then
    perform public.write_audit_log('update', tg_table_name, new.id, v_before, v_after);
  end if;

  return null; -- AFTER trigger
end;
$$;

-- ---------------------------------------------------------------------------
-- Append-only ledgers: the insert itself is the auditable event.
-- ---------------------------------------------------------------------------
create or replace function public.audit_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.write_audit_log('insert', tg_table_name, new.id, null, to_jsonb(new));
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Wiring
-- ---------------------------------------------------------------------------
drop trigger if exists trg_audit_orders_status on public.orders;
create trigger trg_audit_orders_status
  after update on public.orders
  for each row execute function public.audit_status_change('status', 'payment_status');

drop trigger if exists trg_audit_payments_status on public.payments;
create trigger trg_audit_payments_status
  after update on public.payments
  for each row execute function public.audit_status_change('status', 'amount_fils');

drop trigger if exists trg_audit_payments_insert on public.payments;
create trigger trg_audit_payments_insert
  after insert on public.payments
  for each row execute function public.audit_insert();

drop trigger if exists trg_audit_inventory_insert on public.inventory_movements;
create trigger trg_audit_inventory_insert
  after insert on public.inventory_movements
  for each row execute function public.audit_insert();

drop trigger if exists trg_audit_production_status on public.production_queue;
create trigger trg_audit_production_status
  after update on public.production_queue
  for each row execute function public.audit_status_change('status', 'assigned_to', 'production_week');

drop trigger if exists trg_audit_production_insert on public.production_queue;
create trigger trg_audit_production_insert
  after insert on public.production_queue
  for each row execute function public.audit_insert();

drop trigger if exists trg_audit_shipments_status on public.shipments;
create trigger trg_audit_shipments_status
  after update on public.shipments
  for each row execute function public.audit_status_change('status', 'tracking_number');

drop trigger if exists trg_audit_admin_users_change on public.admin_users;
create trigger trg_audit_admin_users_change
  after update on public.admin_users
  for each row execute function public.audit_status_change('role', 'is_active');
