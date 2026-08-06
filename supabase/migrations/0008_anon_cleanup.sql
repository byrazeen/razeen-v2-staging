-- ============================================================================
-- RAZEEN V2 STAGING — 0008_anon_cleanup.sql
--
-- تنظيف الحسابات المجهولة الراكدة — بيد، لا بجدول زمني.
-- Cleanup for stale anonymous accounts — run by hand, never on a timer.
--
-- المشكلة التي يعالجها: تسجيل الدخول المجهول يُنشئ صفاً في `auth.users` عند
-- أول زيارة. زائر يفتح الصفحة ولا يشتري يترك حساباً إلى الأبد. بعد شهور يصبح
-- `auth.users` جدولاً من الأشباح: مئات الآلاف من الحسابات التي لم تفعل شيئاً،
-- تُبطئ كل استعلام يمرّ عليه وتُفسد كل عدّاد «كم مستخدماً لدينا».
--
-- ولماذا لا يُجدوَل تلقائياً؟
--
--   حذف حساب فعلٌ لا رجعة فيه، وهذه دالة تحذف من `auth.users` — أي من جدول
--   لا نملكه ولا كتبنا هجرته. جدولةٌ تعمل كل ليلة تعني أن خطأً في شرط الحماية
--   يُكتشف بعد أن يكون قد حذف. تشغيل يدوي يعني أن إنساناً رأى العدد قبل الحذف.
--   الفرق بين الاثنين هو الفرق بين خطأ يُصحَّح وخطأ يُروى.
--
--   ولأن هذه بيئة تجريبية أصلاً، لا يوجد ضغط تشغيلي يبرّر الأتمتة. حين
--   تنتقل الفكرة إلى الإنتاج، تُجدوَل هناك بقرار معلن ومراجعة، لا بالوراثة
--   من ملف هجرة تجريبي.
--
-- عتبة الاحتفاظ: ٣٠ يوماً.
--
--   الرقم ليس اعتباطياً. المتسوّق المجهول الذي يعود، يعود خلال أيام: يتصفّح،
--   يفكّر، يعود ليشتري. ثلاثون يوماً تغطّي هذه الدورة بهامش واسع — أطول من
--   أي «سأفكّر فيه» معقول. وفي المقابل، الاحتفاظ الأطول لا يشتري شيئاً: حساب
--   مجهول بلا طلب بعد شهر لا يحمل أي معلومة قابلة للاسترداد، فلا بريد يُذكّره
--   ولا هاتف يُثبته ولا سلة تعني شيئاً بعد أن تغيّرت الأسعار.
--   والاتجاه الأخلاقي يدفع في الاتجاه نفسه: بيانات لا غرض لها لا تُحفظ.
--
-- الحارس: «لا طلب».
--
--   هذا هو الشرط الوحيد الذي لا يُساوَم عليه. حساب مرتبط بطلب ليس حساباً
--   راكداً مهما طال سكوته — هو الطرف الآخر في معاملة تجارية. حذفه يقطع
--   `orders.customer_id` عن صاحبه فيصير الطلب يتيماً: لا يُعرف لمن، ولا
--   يستطيع صاحبه رؤيته، ولا يُردّ إليه ماله.
--
--   والقيد في القاعدة يقول الشيء نفسه: `orders.customer_id` مرجع
--   `on delete restrict`. فحتى لو أخطأ شرط الدالة، الحذف يفشل بدل أن يمرّ.
--   لكن الاعتماد على ذلك وحده رهانٌ على أن يبقى القيد كما هو — فالشرط
--   مكتوب صراحةً هنا أيضاً، والاختبار يفحصه.
-- ============================================================================

create or replace function public.cleanup_stale_anonymous_users(
  p_older_than interval default '30 days',
  p_dry_run    boolean  default true,
  p_limit      integer  default 1000
)
returns table (deleted_user_id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_cutoff timestamptz := now() - p_older_than;
begin
  -- عتبة أقصر من يوم على الأرجح خطأ كتابة ('30 minutes' بدل '30 days')، وهي
  -- الحالة التي تُفرغ الجدول. تُرفض بدل أن تُنفَّذ.
  if p_older_than < interval '1 day' then
    raise exception 'cleanup_stale_anonymous_users: عتبة أقصر من يوم مرفوضة (وصل %)', p_older_than
      using errcode = '22023';
  end if;

  create temporary table if not exists _stale_anon (id uuid primary key, created_at timestamptz)
    on commit drop;
  delete from _stale_anon;

  -- المرشّحون: مجهول · أقدم من العتبة · بلا أي طلب — لا مباشرةً ولا عبر صف
  -- العميل المرتبط به. الفحص عبر `customers` لأن `orders` لا تحمل user_id.
  insert into _stale_anon (id, created_at)
  select u.id, u.created_at
    from auth.users u
   where coalesce(u.is_anonymous, false)
     and u.created_at < v_cutoff
     and not exists (
       select 1
         from public.customers c
         join public.orders o on o.customer_id = c.id
        where c.user_id = u.id
     )
   order by u.created_at
   limit greatest(p_limit, 0);

  if p_dry_run then
    -- الوضع الافتراضي: يُظهر ما كان سيُحذف ولا يحذف. تشغيلٌ أول بلا وسائط
    -- لا يمكن أن يُتلف شيئاً — وهذا مقصود، لأن الوسيط الافتراضي هو ما يكتبه
    -- من يجرّب الدالة لأول مرة.
    return query select s.id, s.created_at from _stale_anon s order by s.created_at;
    return;
  end if;

  -- الحذف الفعلي. صفوف `customers` و`carts` المعلّقة بهم تُحذف بالتتابع
  -- (customers.user_id ليس مفتاحاً أجنبياً، فتُنظَّف صراحةً).
  delete from public.carts     where user_id in (select id from _stale_anon);
  delete from public.customers where user_id in (select id from _stale_anon);
  delete from auth.users       where id      in (select id from _stale_anon);

  return query select s.id, s.created_at from _stale_anon s order by s.created_at;
end;
$$;

revoke all on function public.cleanup_stale_anonymous_users(interval, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.cleanup_stale_anonymous_users(interval, boolean, integer)
  to service_role;

comment on function public.cleanup_stale_anonymous_users(interval, boolean, integer) is
$c$تنظيف الحسابات المجهولة الراكدة. تُشغَّل يدوياً فقط — لا cron ولا pg_cron.

كيف تُشغَّل (بمفتاح service_role، من psql أو SQL editor):

  -- ١) استعراض: ماذا كان سيُحذف؟ (الوضع الافتراضي، لا يحذف شيئاً)
  select * from public.cleanup_stale_anonymous_users();

  -- ٢) العدّ قبل القرار
  select count(*) from public.cleanup_stale_anonymous_users('30 days', true, 100000);

  -- ٣) الحذف الفعلي، على دفعات
  select * from public.cleanup_stale_anonymous_users('30 days', false, 1000);

العتبة ٣٠ يوماً: تغطّي دورة عودة المتسوّق المتردّد بهامش واسع، وما بعدها لا
يحمل الحساب المجهول أي معلومة قابلة للاسترداد (لا بريد ولا هاتف مُثبَت).

الحارس: لا يُحذف حساب له طلب، أبداً. حذفه يترك الطلب يتيماً بلا صاحب. القيد
orders.customer_id ... on delete restrict يقول الشيء نفسه في القاعدة، والشرط
مكرّر في جسم الدالة كي لا تكون الحماية رهينة بقاء القيد.

الصلاحية لـservice_role وحده: لا authenticated ولا anon.$c$;
