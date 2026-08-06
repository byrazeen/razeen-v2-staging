-- تحصين سجل التدقيق ومسار البحث.
--
-- كشفه فحص Supabase الأمني بعد أول تطبيق على مشروع حقيقي، وأُكِّد بهجوم فعلي:
-- عميل موقّع نفّذ `write_audit_log(...)` عبر PostgREST وأدرج صفاً في
-- `audit_logs`. وهذا ينقض غرض 0003 المعلن — أن السجل لا يُكتب باليد.
--
-- السبب: `audit_logs` بلا سياسة إدراج لأحد، وهذا صحيح، لكن الدالة التي تكتب
-- فيها `SECURITY DEFINER` وتبقى صلاحية تنفيذها ممنوحة لـpublic ضمناً. فالباب
-- لم يكن الجدول بل الدالة، وPostgREST يكشف كل دالة في `public` كنقطة RPC.
--
-- القيد `audit_logs_action_check` أعطى انطباعاً كاذباً بالحماية: أوقف أول
-- محاولة لأن قيمة الإجراء غير مسموحة، فبدت الدالة محميّة. وبقيمة مسموحة نجح
-- الإدراج. قيدُ نطاقٍ ليس ضابط صلاحية.

-- ١) دوال الكتابة في السجل ليست واجهة عامة.
--
-- إبطال EXECUTE عن public يزيلها من سطح RPC. والـtriggers تبقى تعمل: صلاحية
-- تنفيذ دالة الـtrigger تُفحص عند إنشائه لا عند إطلاقه.
revoke execute on function public.write_audit_log(text, text, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.audit_insert() from public, anon, authenticated;
revoke execute on function public.audit_status_change() from public, anon, authenticated;

-- خدمة الخادم وحدها تكتب سجلاً مباشرة.
grant execute on function public.write_audit_log(text, text, uuid, jsonb, jsonb) to service_role;

-- ١-ب) دالة ليست من هجراتنا لكنها في مشروعنا.
--
-- `rls_auto_enable()` دالة SECURITY DEFINER يستدعيها event trigger على مستوى
-- المشروع لتفعيل RLS تلقائياً على كل جدول جديد. لم نكتبها ولا توجد في المستودع،
-- لكنها مكشوفة كنقطة RPC مثل غيرها. ليست واجهة، فتُسحب من السطح العام.
--
-- تنبيه مهم مترتب عليها: RLS كان مفعّلاً على الجداول الستة عشر قبل أن يصل
-- `enable row level security` في 0002 — فحالة "RLS مفعّل" هنا ليست وحدها دليلاً
-- على أن 0002 نُفِّذ. السياسات هي الدليل، ولذلك تُفحص السياسات لا الراية.
do $$
begin
  execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
exception when undefined_function then
  raise notice 'rls_auto_enable() غير موجودة في هذا المشروع — تُتجاوز';
end $$;

-- ٢) تثبيت search_path على الدالتين اللتين أغفلتاه.
--
-- دالة SECURITY DEFINER بمسار بحث متغيّر تسمح لمن يتحكم بالمسار أن يقدّم كائناً
-- مُنتحِلاً باسم مطابق فيُنفَّذ بصلاحيات المالك. البقية في 0002 و0003 تثبّته،
-- وهاتان استُثنيتا سهواً.
alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.production_queue_requires_paid_order() set search_path = public, pg_temp;

-- ملاحظة مقصودة: دوال الملكية الخمس (is_admin · current_customer_id ·
-- owns_cart · owns_order · owns_custom_request) تبقى ممنوحة لـanon
-- وauthenticated. سياسات RLS تستدعيها بصلاحيات المُستدعي، فسحبها يُعطّل
-- الحماية بدل أن يشدّها. وهي تقرأ ولا تكتب، وتُرجع ما يخص المستدعي وحده.
