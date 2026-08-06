-- ============================================================================
-- RAZEEN V2 STAGING — supabase/test/shim.sql
--
-- ⚠️  TEST ONLY. THIS FILE IS NEVER APPLIED TO A SUPABASE PROJECT. ⚠️
--
-- It deliberately lives outside supabase/migrations/ so that `supabase db push`
-- can never pick it up. Applying it to a real project would replace Supabase's
-- own auth.uid() with a stub and hand out roles by hand.
--
-- Why it exists: the RLS suite runs against a plain PostgreSQL service
-- container in CI, which has no `auth` schema and none of the Supabase roles.
-- Rather than weaken the policies so they run without Supabase, we recreate the
-- three things the policies actually depend on:
--
--   1. the auth schema
--   2. auth.uid(), reading the `sub` claim out of request.jwt.claims — exactly
--      the GUC that Supabase's PostgREST sets per request
--   3. the roles anon / authenticated / service_role, with service_role
--      carrying BYPASSRLS as it does on Supabase
--
-- The migrations in supabase/migrations/ then run completely unmodified, so
-- what CI proves is the same SQL that ships.
-- ============================================================================

create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
    ''
  )::uuid;
$$;

-- auth.jwt() — الادّعاءات كاملةً كما يضعها PostgREST في نفس الـGUC.
--
-- أُضيفت حين صار المتسوّق المجهول واقعاً: Supabase لا يعطي المجهول دوراً
-- خاصاً، بل الدور `authenticated` نفسه، ويفرّقه بادّعاء `is_anonymous: true`
-- وحده. فما لم تُقرأ الادّعاءات هنا كما تُقرأ هناك، تكون المجموعة تختبر
-- عالماً لا وجود له — عالماً فيه المجهول والدائم شيء واحد.
--
-- `coalesce(..., '{}')` مقصود: جلسة بلا GUC (أو بقيمة فارغة) يجب أن تُنتج
-- كائناً فارغاً لا خطأً، تماماً كما يفعل Supabase مع طلب بلا رمز.
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

-- auth.role() is referenced by some Supabase idioms; provided for parity.
create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'role', ''),
    'anon'
  );
$$;

-- auth.users — الأعمدة الثلاثة التي تعتمد عليها هجراتنا فقط.
--
-- هذا ليس جدول Supabase الحقيقي ولا يحاول أن يكونه؛ فيه عشرات الأعمدة لا شأن
-- لنا بها. لكن `cleanup_stale_anonymous_users()` في 0008 تقرأ `is_anonymous`
-- و`created_at` وتحذف بـ`id`، ودالة لا يوجد جدولها لا تُختبَر إطلاقاً — تُنشأ
-- بنجاح (plpgsql لا يفحص الأسماء عند الإنشاء) ثم تنفجر عند أول استدعاء.
-- وجود الجدول هنا هو ما يحوّل «الحارس مكتوب» إلى «الحارس يمنع».
create table if not exists auth.users (
  id           uuid primary key,
  email        text,
  is_anonymous boolean not null default false,
  created_at   timestamptz not null default now()
);

grant usage on schema auth to public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- The test connection must be able to SET ROLE into each of them. A superuser
-- already can; this makes the suite work for a non-superuser owner too.
do $$
begin
  execute format('grant anon, authenticated, service_role to %I', current_user);
exception when insufficient_privilege then
  null; -- already a superuser, or membership already implied
end
$$;
