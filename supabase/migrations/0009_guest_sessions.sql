-- ============================================================================
-- RAZEEN V2 STAGING — 0009_guest_sessions.sql
--
-- هوية الضيف في مخططنا نحن، لا في لوحة تحكّم Supabase.
-- Guest identity in OUR schema — zero dashboard configuration.
--
-- لماذا؟ «تسجيل الدخول المجهول» في Supabase يحتاج مفتاحاً يُقلَب في لوحة
-- التحكّم. مفتاحٌ لا يُبلَغ إليه من هذه البيئة، وأسوأ من ذلك: مفتاحٌ يجعل
-- سلامة النظام تعتمد على إعداد لا يظهر في أي ملف هجرة ولا يفحصه أي اختبار.
-- ما لا يُطبَّق بهجرة لا يُراجَع، وما لا يُراجَع ينكسر بصمت. فالقرار: تُسقَط
-- التبعية كاملةً، وتنتقل هوية الضيف إلى جدول نملكه ونختبره.
--
-- ما الذي يتغيّر في معنى «الملكية»؟
--
--   قبل: الصف لك إن كان `user_id = auth.uid()`. المتسوّق المجهول كان يحمل
--         auth.uid() لأن Supabase أعطاه واحداً.
--   بعد: للضيف محور ثانٍ مستقلّ تماماً — `guest_session_id`. لا JWT فيه، ولا
--         صفّ في `auth.users`، ولا شيء يقلَب في لوحة تحكّم.
--
--   المحوران يتعايشان ولا يتداخلان: صف الضيف له `guest_session_id` و`user_id`
--   فارغ، وصف العميل الموقّع بالعكس. كل سياسة كُتبت في 0002–0006 تبقى كما هي
--   وتظل صحيحة، لأن `user_id = auth.uid()` على صف ضيف تُقارن NULL بشيء فتُرجع
--   NULL — أي «لا» — وهو الجواب الصحيح.
--
-- الفارق الجوهري عن `auth.uid()`: الضيف لا يُثبِت هويته للقاعدة عبر JWT، بل
-- عبر رمز يرسله في نص الاستدعاء. ومعنى ذلك أن RLS وحدها لا تكفي: تعبير سياسة
-- لا يرى وسائط الدالة. فالحلّ ليس تمرير الرمز إلى السياسة (عبر GUC مثلاً —
-- وهو باب خلفي: من يستطيع ضبط GUC يستطيع انتحال أي جلسة)، بل إغلاق الجداول
-- أمام الضيف تماماً وجعل كل عملية تمرّ بدالة SECURITY DEFINER تتحقّق من الرمز
-- بنفسها. هذا الملف يبني الحالة؛ و0010 يبني الأبواب.
--
-- ---------------------------------------------------------------------------
-- الرمز لا يُخزَّن أبداً. يُخزَّن هاشه.
--
--   الرمز الخام يوجد مرّة واحدة في عمر النظام: في القيمة التي تُعيدها
--   issue_guest_token() لصاحبها. بعدها لا أثر له في القاعدة ولا في نسخة
--   احتياطية ولا في سجل. تسريب القاعدة كاملةً لا يمنح المهاجم جلسة واحدة.
--
--   والقيد `token_hash ~ '^[0-9a-f]{64}$'` ليس تجميلاً: الرمز الخام يبدأ
--   بسابقة `rzn_guest_` وطوله ٧٤ محرفاً، فهو لا يمكن أن يمرّ من هذا القيد.
--   أي محاولة مستقبلية لكتابة الرمز الخام في هذا العمود — سهواً أو عمداً —
--   تفشل في القاعدة لا في مراجعة الشيفرة.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- ١) ثوابت السياسة، كدوال — كي يقرأها الاختبار بدل أن يعيد كتابتها
--    (النمط نفسه المستعمل في 0007 لأرقام التسعير)
-- ===========================================================================

-- عمر الجلسة: ٣٠ يوماً.
--   الرقم موروث من 0008 بقصد: هو نفسه عتبة تنظيف الحسابات المجهولة هناك،
--   ولا سبب لأن يختلف رقمان يصفان الشيء ذاته — «كم يعود المتسوّق المتردّد؟».
--   المتسوّق الذي يعود يعود خلال أيام. ثلاثون يوماً تغطّي الدورة بهامش واسع،
--   وما بعدها لا يحمل الرمز شيئاً قابلاً للاسترداد: لا بريد يُذكّر صاحبه ولا
--   هاتف يُثبته، والسلة بعد شهر تصف أسعاراً تغيّرت.
create or replace function public.guest_session_ttl() returns interval
  language sql immutable set search_path = public, pg_temp as $$ select interval '30 days' $$;

-- سقف إصدار الجلسات: ٣٠٠ رمز لكل نافذة ١٠ دقائق — عالمياً، لا لكل عنوان IP.
--
--   ⚠️ اعتراف صريح على المحور: عنوان IP غير مرئي لدالة SQL. PostgREST لا
--   يمرّره إلى القاعدة، و`inet_client_addr()` تُرجع عنوان مُجمِّع الاتصالات
--   (Supavisor) لا عنوان المتصفّح. فالمحور الوحيد القابل للفرض هنا هو الزمن
--   العالمي. وهذا يعني بوضوح: هذا السقف يحمي القاعدة من الإغراق، ولا يمنع
--   مهاجماً واحداً من استهلاك حصّة الجميع. الحدّ لكل IP يخصّ طبقة الحافة
--   (WAF/Edge Function)، لا هذه الطبقة، وادّعاء غير ذلك هنا كان سيكون كذباً
--   مريحاً.
--
--   لماذا ٣٠٠/١٠د؟ الزائر الواحد يحتاج رمزاً واحداً كل ٣٠ يوماً. ٣٠٠ في عشر
--   دقائق تساوي ٤٣ ألف زائر جديد يومياً — أضعاف ما تراه بيئة تجريبية بمراحل،
--   فالسقف لا يلمس استعمالاً مشروعاً. وفي المقابل هو أقل بكثير من العدد الذي
--   يُنتفَع به في تضخيم الجدول: مليون صف تحتاج ٢٣ يوماً متواصلة من الإغراق
--   بأقصى المعدّل المسموح.
create or replace function public.guest_issue_window() returns interval
  language sql immutable set search_path = public, pg_temp as $$ select interval '10 minutes' $$;

create or replace function public.guest_issue_cap() returns integer
  language sql immutable set search_path = public, pg_temp as $$ select 300 $$;

-- سقف محاولات الدفع: ١٠ لكل جلسة في كل ساعة.
--
--   هذا المحور مرئي فعلاً — الجلسة معرّفة بالرمز المُتحقَّق منه — فالسقف هنا
--   يفعل ما يُعلنه بالضبط. عشرة: المتسوّق الذي يفشل دفعه يعيد المحاولة مرّة
--   أو مرّتين ثم يغيّر البطاقة؛ عشر محاولات في ساعة هي ضعف أسوأ سيناريو
--   مشروع. وما فوقها إمّا خللٌ في المتصفّح يعيد الإرسال في حلقة، أو مسحٌ
--   لمفاتيح idempotency — وكلاهما يستحق التوقّف لا الخدمة.
--
--   ⚠️ اعتراف صريح ثانٍ، على ما يُحصى: العدّاد يُزاد داخل معاملة الاستدعاء
--   نفسها. فالاستدعاء الذي يُثبَّت يُحصى — نجاحاً كان أو إعادةً بمفتاح
--   idempotency سابق — أمّا الاستدعاء الذي يرفع خطأً (بند غير صالح مثلاً)
--   فيتراجع عدّاده معه. لا مفرّ من ذلك بلا معاملة مستقلة، وهي غير متاحة في
--   plpgsql. والمعنى العملي: هذا السقف يحدّ من إنشاء الطلبات، لا من حركة
--   الأخطاء. حدّ الأخطاء يخصّ طبقة الحافة، تماماً كحدّ الـIP أعلاه.
create or replace function public.guest_checkout_window() returns interval
  language sql immutable set search_path = public, pg_temp as $$ select interval '1 hour' $$;

create or replace function public.guest_checkout_cap() returns integer
  language sql immutable set search_path = public, pg_temp as $$ select 10 $$;

revoke all on function public.guest_session_ttl()     from public, anon, authenticated;
revoke all on function public.guest_issue_window()    from public, anon, authenticated;
revoke all on function public.guest_issue_cap()       from public, anon, authenticated;
revoke all on function public.guest_checkout_window() from public, anon, authenticated;
revoke all on function public.guest_checkout_cap()    from public, anon, authenticated;
grant execute on function public.guest_session_ttl()     to service_role;
grant execute on function public.guest_issue_window()    to service_role;
grant execute on function public.guest_issue_cap()       to service_role;
grant execute on function public.guest_checkout_window() to service_role;
grant execute on function public.guest_checkout_cap()    to service_role;

-- ===========================================================================
-- ٢) guest_sessions — الجدول الذي لا يراه عميل قطّ
-- ===========================================================================
create table if not exists public.guest_sessions (
  id            uuid primary key default gen_random_uuid(),

  -- sha256 بصيغة hex. لا الرمز، ولا جزء منه، ولا شيء يُشتق منه عكسياً.
  token_hash    text not null unique
                check (token_hash ~ '^[0-9a-f]{64}$'),

  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '30 days',
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz,

  -- عدّاد محاولات الدفع ونافذته. على الصف لا في جدول جانبي: العدّاد صفة
  -- للجلسة، وجدول جانبي كان سيسمح بعدّاد بلا جلسة أو جلسة بلا عدّاد.
  checkout_attempts        integer     not null default 0 check (checkout_attempts >= 0),
  checkout_window_start    timestamptz not null default now()

  -- لا قيد `expires_at > created_at` هنا بقصد: تقصير عمر جلسة إلى الماضي هو
  -- كيف تُنهى جلسة بيد المشغّل، وقيدٌ يمنعه كان سيمنع الإنهاء لا التزوير.
  -- والقيمة الافتراضية تأتي من الخادم لا من مستدعٍ، فلا مدخل لقيمة عبثية.
);

create index if not exists idx_guest_sessions_expires   on public.guest_sessions (expires_at);
create index if not exists idx_guest_sessions_last_seen on public.guest_sessions (last_seen_at);
create index if not exists idx_guest_sessions_revoked   on public.guest_sessions (revoked_at)
  where revoked_at is not null;

comment on table public.guest_sessions is
  'هوية الضيف. لا يقرأها ولا يكتبها أي دور عميل — لا anon ولا authenticated: '
  'لا GRANT ولا سياسة. الوصول الوحيد عبر دوال SECURITY DEFINER في 0010. '
  'الرمز الخام لا يُخزَّن هنا إطلاقاً؛ العمود المخزَّن هو sha256 بصيغة hex.';

comment on column public.guest_sessions.token_hash is
  'sha256(الرمز الخام) بصيغة hex، ٦٤ محرفاً. القيد يمنع كتابة الرمز الخام هنا '
  'حتى بالخطأ: الرمز الخام يبدأ بـrzn_guest_ فلا يطابق النمط.';

-- ---------------------------------------------------------------------------
-- ٢-ب) دفتر إصدار الجلسات — دلو زمني عالمي
--
-- صف واحد لكل نافذة، والمفتاح هو بداية النافذة. `insert ... on conflict do
-- update` يجعل الزيادة ذرّية بلا قفل صريح: استدعاءان متزامنان يتسلسلان على
-- قفل الصف نفسه، فلا يقرأ أحدهما عدّاداً بائتاً.
-- ---------------------------------------------------------------------------
create table if not exists public.guest_issue_counters (
  window_start timestamptz primary key,
  issued       integer not null default 0 check (issued >= 0)
);

comment on table public.guest_issue_counters is
  'دلو زمني عالمي لسقف إصدار رموز الضيوف. المحور هو الزمن لا عنوان IP — '
  'وعنوان IP غير مرئي لدالة SQL أصلاً (PostgREST لا يمرّره، و'
  'inet_client_addr() تُرجع عنوان المُجمِّع). انظر guest_issue_cap().';

-- ---------------------------------------------------------------------------
-- ٢-ج) الإغلاق التام: لا صلاحية، ولا سياسة، ولا استثناء
--
-- RLS مفعّلة وبلا سياسة واحدة = نفيٌ كامل لكل دور غير BYPASSRLS. وسحب
-- الصلاحيات فوقها لأن الطبقتين تفشلان بطريقتين مختلفتين (المنطق نفسه الموثّق
-- في 0006): السحب يفشل قبل تقييم السياسات، والسياسة الغائبة تفشل بعدها.
--
-- `revoke ... from anon, authenticated` بالاسم لا `from public` وحده: للمشروع
-- ALTER DEFAULT PRIVILEGES يمنح صلاحيات لهذين الدورين على ما يُنشأ حديثاً،
-- فالمنح صريح في الـACL ولا يسقط بسحب امتياز PUBLIC.
-- ---------------------------------------------------------------------------
alter table public.guest_sessions       enable row level security;
alter table public.guest_issue_counters enable row level security;

revoke all on public.guest_sessions       from public, anon, authenticated;
revoke all on public.guest_issue_counters from public, anon, authenticated;
grant all on public.guest_sessions        to service_role;
grant all on public.guest_issue_counters  to service_role;

-- حتى لو أعاد أحدهم المنح لاحقاً بحسن نيّة، السياسة المقيِّدة تبقى نفياً
-- مطلقاً. هذه هي الحماية التي لا تسقط بـGRANT واحد.
drop policy if exists guest_sessions_no_client on public.guest_sessions;
create policy guest_sessions_no_client on public.guest_sessions
  as restrictive for all to authenticated, anon
  using (false) with check (false);

drop policy if exists guest_issue_counters_no_client on public.guest_issue_counters;
create policy guest_issue_counters_no_client on public.guest_issue_counters
  as restrictive for all to authenticated, anon
  using (false) with check (false);

-- ===========================================================================
-- ٣) محور الملكية الجديد على الجداول التي يملكها الضيف
--
-- في كل موضع: `on delete restrict` حيث يكون الحذف كارثة (الطلب وصفّ العميل
-- المرتبط به)، و`on delete cascade` حيث يكون الحذف هو المقصود (السلة).
-- القيد نفسه هو ما يجعل «لا تُحذف جلسة لها طلب» حقيقةً في القاعدة لا وعداً
-- في جسم دالة — النمط نفسه الموثّق في 0008.
-- ===========================================================================

-- ٣-أ) carts
alter table public.carts
  add column if not exists guest_session_id uuid
    references public.guest_sessions (id) on delete cascade;

create index if not exists idx_carts_guest_session on public.carts (guest_session_id);

-- سلة مفتوحة واحدة لكل جلسة ضيف — نظير uq_open_cart_per_user على المحور الجديد.
create unique index if not exists uq_open_cart_per_guest_session
  on public.carts (guest_session_id)
  where status = 'open' and guest_session_id is not null;

alter table public.carts drop constraint if exists cart_has_owner;
alter table public.carts add constraint cart_has_owner
  check (customer_id is not null or session_token is not null
         or user_id is not null or guest_session_id is not null);

-- ٣-ب) customers — الضيف يملك صف عميل بلا user_id
--
-- `user_id` كان المحور الوحيد. الآن قد يكون الصف مملوكاً بجلسة ضيف بدلاً منه.
-- والفهرس الفريد يمنع صفّي عميل لجلسة واحدة.
alter table public.customers
  add column if not exists guest_session_id uuid
    references public.guest_sessions (id) on delete restrict;

create unique index if not exists uq_customers_guest_session
  on public.customers (guest_session_id) where guest_session_id is not null;

-- ٣-ج) orders — `restrict` هنا هو الحارس الحقيقي
--
-- حذف جلسة لها طلب يترك الطلب بلا صاحب: لا يُعرف لمن، ولا يستطيع صاحبه
-- تتبّعه، ولا يُردّ إليه ماله. القيد يجعل ذلك مستحيلاً لا مستبعداً — فحتى لو
-- أخطأ شرط دالة التنظيف، الحذف يفشل بدل أن يمرّ.
alter table public.orders
  add column if not exists guest_session_id uuid
    references public.guest_sessions (id) on delete restrict;

create index if not exists idx_orders_guest_session on public.orders (guest_session_id);

-- ٣-د) custom_perfume_requests
--
-- `customer_id` كان NOT NULL، وهذا كان صحيحاً حين لم يكن هناك مالك آخر. الضيف
-- يستطيع أن يطلب عطراً مخصّصاً قبل أن يكون له صف عميل إطلاقاً (صف العميل
-- يحتاج اسماً وهاتفاً، وهما لا يُسألان إلا عند الدفع). فيُخفَّف العمود ويُشترط
-- بدلاً منه وجود أحد المالكَين — لا سقوط في «صف بلا مالك».
alter table public.custom_perfume_requests
  add column if not exists guest_session_id uuid
    references public.guest_sessions (id) on delete cascade;

create index if not exists idx_cpr_guest_session
  on public.custom_perfume_requests (guest_session_id);

alter table public.custom_perfume_requests alter column customer_id drop not null;

alter table public.custom_perfume_requests drop constraint if exists cpr_has_owner;
alter table public.custom_perfume_requests add constraint cpr_has_owner
  check (customer_id is not null or guest_session_id is not null);

comment on column public.custom_perfume_requests.customer_id is
  'صف العميل، إن وُجد. صار قابلاً للـNULL في 0009: الضيف قد يطلب عطراً مخصّصاً '
  'قبل أن يُسأل اسمه وهاتفه. القيد cpr_has_owner يمنع الصف اليتيم.';

-- ===========================================================================
-- ٤) صفوف الضيف محجوبة عن كل جلسة عميل — نفياً، لا بغياب سياسة
--
-- الحال اليوم آمن أصلاً: صف الضيف له `user_id = null`، والسياسات القائمة
-- تقارنه بـauth.uid() فتُرجع NULL أي «لا». لكن هذا أمانٌ بالمصادفة: سياسة
-- مسموحة تُضاف لاحقاً بصيغة أوسع تكفي لفتحه، وهي الحالة التي وُصفت في 0006
-- بالضبط. فتُكتب الحماية نفياً صريحاً: صفّ يحمل guest_session_id لا يراه ولا
-- يمسّه أي دور عميل. المدير مستثنى — الوحدة الإدارية هي المشتري نفسه.
--
-- والدوال في 0010 هي SECURITY DEFINER يملكها صاحب الجداول، فلا تخضع لهذه
-- السياسات إطلاقاً — وهو المقصود: الباب الوحيد هو الدالة التي تتحقّق من الرمز.
-- ===========================================================================
drop policy if exists carts_guest_rows_hidden on public.carts;
create policy carts_guest_rows_hidden on public.carts
  as restrictive for all to authenticated, anon
  using (guest_session_id is null or public.is_admin())
  with check (guest_session_id is null or public.is_admin());

drop policy if exists customers_guest_rows_hidden on public.customers;
create policy customers_guest_rows_hidden on public.customers
  as restrictive for all to authenticated, anon
  using (guest_session_id is null or public.is_admin())
  with check (guest_session_id is null or public.is_admin());

drop policy if exists orders_guest_rows_hidden on public.orders;
create policy orders_guest_rows_hidden on public.orders
  as restrictive for all to authenticated, anon
  using (guest_session_id is null or public.is_admin())
  with check (guest_session_id is null or public.is_admin());

drop policy if exists cpr_guest_rows_hidden on public.custom_perfume_requests;
create policy cpr_guest_rows_hidden on public.custom_perfume_requests
  as restrictive for all to authenticated, anon
  using (guest_session_id is null or public.is_admin())
  with check (guest_session_id is null or public.is_admin());

-- بنود السلة وبنود الطلب لا تحمل المحور بنفسها: كلاهما يرث مالكه من أبيه
-- (cart_id / order_id). لو حمل البند مالكاً مستقلاً لأمكن أن يفترق الاثنان —
-- بند يملكه ضيف داخل سلة يملكها موقّع. المنطق نفسه المشروح في 0005 §٥.
drop policy if exists cart_items_guest_rows_hidden on public.cart_items;
create policy cart_items_guest_rows_hidden on public.cart_items
  as restrictive for all to authenticated, anon
  using (
    public.is_admin()
    or not exists (select 1 from public.carts c
                    where c.id = cart_id and c.guest_session_id is not null)
  )
  with check (
    public.is_admin()
    or not exists (select 1 from public.carts c
                    where c.id = cart_id and c.guest_session_id is not null)
  );

drop policy if exists order_items_guest_rows_hidden on public.order_items;
create policy order_items_guest_rows_hidden on public.order_items
  as restrictive for all to authenticated, anon
  using (
    public.is_admin()
    or not exists (select 1 from public.orders o
                    where o.id = order_id and o.guest_session_id is not null)
  )
  with check (
    public.is_admin()
    or not exists (select 1 from public.orders o
                    where o.id = order_id and o.guest_session_id is not null)
  );

-- الصلاحية على الأعمدة الجديدة على `carts`: 0005 §٨ منح UPDATE بأعمدة مسمّاة،
-- والمنح المسمّى لا يشمل عموداً أُضيف بعده. وهو غائب هنا بقصد — العميل الموقّع
-- لا شأن له بهذا العمود، ولو مُنح لأمكنه نقل سلته إلى جلسة ضيف (والسياسة
-- المقيِّدة أعلاه كانت سترفض، لكن الطبقتين خير من واحدة).
